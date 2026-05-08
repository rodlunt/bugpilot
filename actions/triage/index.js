const core = require('@actions/core')
const github = require('@actions/github')
const Anthropic = require('@anthropic-ai/sdk')

const SYSTEM_PROMPT = `You are a senior engineer triaging user-submitted bug reports and feature requests.
You will be given a structured report from bugpilot. Analyse it carefully and call the triage_report tool with your assessment.

For bugs:
- Is it reproducible given the information provided?
- What is the likely root cause?
- What is the proposed fix? Be specific about what code or behaviour needs to change — one or two sentences, no actual code.

For feature requests:
- Is it feasible and well-defined?
- What is the effort level?
- proposed_fix should be null.

Always draft a friendly, human response_draft to post back to the reporter.`

async function run() {
  const apiKey = core.getInput('anthropic-api-key', { required: true })
  const token = core.getInput('github-token')
  const model = core.getInput('model') || 'claude-sonnet-4-6'

  const octokit = github.getOctokit(token)
  const { context } = github
  const issue = context.payload.issue
  const { owner, repo } = context.repo

  const labelNames = issue.labels.map((l) => l.name)
  if (!labelNames.includes('user-feedback')) {
    core.info('No user-feedback label — skipping')
    return
  }

  const structured = parseStructuredBlock(issue.body)
  const issueUrl = `https://github.com/${owner}/${repo}/issues/${issue.number}`
  core.info(`Triaging issue #${issue.number} (type: ${structured?.type ?? 'unknown'})`)

  // Feature requests don't need AI triage — just acknowledge and notify
  if (structured?.type === 'feature' || labelNames.includes('enhancement')) {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: `### Feature request logged\n\nThanks for the suggestion — this has been added to the backlog for review. [View issue](${issueUrl})`,
    })
    const ntfyTopic = core.getInput('ntfy-topic')
    if (ntfyTopic) {
      await sendNtfyFeature({ ntfyTopic, issue, issueUrl })
    }
    return
  }

  const client = new Anthropic.default({ apiKey })

  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [triageTool()],
    tool_choice: { type: 'tool', name: 'triage_report' },
    messages: [
      {
        role: 'user',
        content: buildUserMessage(issue, structured),
      },
    ],
  })

  const toolUse = message.content.find((b) => b.type === 'tool_use')
  if (!toolUse) {
    core.setFailed('Claude did not call triage_report tool')
    return
  }

  const triage = toolUse.input
  core.info(`Triage result: ${JSON.stringify(triage)}`)

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issue.number,
    body: buildComment(triage),
  })

  const newLabels = deriveLabels(triage)
  if (newLabels.length) {
    await ensureLabelsExist(octokit, owner, repo, newLabels)
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issue.number,
      labels: newLabels,
    })
  }

  const ntfyTopic = core.getInput('ntfy-topic')
  const webhookSecret = core.getInput('webhook-secret')
  if (ntfyTopic) {
    await sendNtfy({ ntfyTopic, webhookSecret, issue, issueUrl, triage, owner, repo })
  }
}

function triageTool() {
  return {
    name: 'triage_report',
    description: 'Submit triage results for a user report',
    input_schema: {
      type: 'object',
      required: ['classification', 'response_draft'],
      properties: {
        classification: {
          type: 'string',
          enum: ['bug', 'feature', 'not-feasible', 'spam', 'needs-info'],
          description: 'Type of report',
        },
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Bug severity only — omit for features',
        },
        reproducible: {
          type: 'boolean',
          description: 'Whether the bug appears reproducible from the report',
        },
        proposed_fix: {
          type: 'string',
          description: 'Concise description of what needs to change to fix the bug. Null for features.',
        },
        response_draft: {
          type: 'string',
          description: 'Friendly response to post to the reporter',
        },
      },
    },
  }
}

function buildUserMessage(issue, structured) {
  const structuredBlock = structured
    ? `\n\nMachine-readable context:\n\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\``
    : ''

  return `Issue #${issue.number}: ${issue.title}\n\n${issue.body}${structuredBlock}`
}

function parseStructuredBlock(body) {
  if (!body) return null
  const match = body.match(/<!-- bugpilot:structured\n([\s\S]*?)\nbugpilot:end -->/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function buildComment(triage) {
  const lines = ['### bugpilot triage', '']

  const classLabel = {
    bug: 'Bug',
    feature: 'Feature request',
    'not-feasible': 'Not feasible',
    spam: 'Spam',
    'needs-info': 'Needs more information',
  }[triage.classification] ?? triage.classification

  lines.push(`**Classification:** ${classLabel}`)

  if (triage.severity) {
    lines.push(`**Severity:** ${triage.severity}`)
  }
  if (triage.reproducible !== undefined && triage.reproducible !== null) {
    lines.push(`**Reproducible:** ${triage.reproducible ? 'Yes' : 'Unclear from report'}`)
  }
  if (triage.proposed_fix) {
    lines.push('', `**Proposed fix:** ${triage.proposed_fix}`)
  }
  if (triage.response_draft) {
    lines.push('', '**Draft response to reporter:**', '')
    lines.push(`> ${triage.response_draft.replace(/\n/g, '\n> ')}`)
  }

  return lines.join('\n')
}

function deriveLabels(triage) {
  const labels = []
  const classMap = {
    bug: 'triage:confirmed-bug',
    feature: 'triage:feature-request',
    'not-feasible': 'triage:not-feasible',
    spam: 'triage:spam',
    'needs-info': 'triage:needs-info',
  }
  if (classMap[triage.classification]) labels.push(classMap[triage.classification])
  if (triage.severity) labels.push(`severity:${triage.severity}`)
  return labels
}

async function sendNtfyFeature({ ntfyTopic, issue, issueUrl }) {
  const payload = {
    topic: ntfyTopic.replace(/^https?:\/\/ntfy\.sh\//, ''),
    title: 'Feature request submitted',
    message: issue.title.replace(/^\[.*?\]\s*Feature:\s*/, '').slice(0, 120),
    actions: [
      { action: 'view', label: 'View request', url: issueUrl },
    ],
  }
  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    core.warning(`NTFY notification failed: ${res.status} ${await res.text()}`)
  } else {
    core.info('NTFY feature notification sent')
  }
}

async function sendNtfy({ ntfyTopic, webhookSecret, issue, issueUrl, triage, owner, repo }) {
  const workerBase = process.env.BUGPILOT_WORKER_URL

  const severityPart = triage.severity ? ` [${triage.severity}]` : ''
  const title = `Bug${severityPart}: ${issue.title.replace(/^\[.*?\]\s*Bug:\s*/, '').slice(0, 80)}`
  const message = triage.proposed_fix || 'Triage complete — no fix proposed.'

  const actions = []

  if (workerBase && webhookSecret) {
    actions.push({
      action: 'http',
      label: 'Apply fix',
      url: `${workerBase}/webhook/apply-fix`,
      method: 'POST',
      headers: { 'x-webhook-secret': webhookSecret },
      body: JSON.stringify({ issue_number: issue.number, owner, repo }),
    })
  }

  actions.push({
    action: 'view',
    label: 'Manual review',
    url: issueUrl,
  })

  const payload = { topic: ntfyTopic.replace(/^https?:\/\/ntfy\.sh\//, ''), title, message, actions }

  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    core.warning(`NTFY notification failed: ${res.status} ${await res.text()}`)
  } else {
    core.info('NTFY notification sent')
  }
}

async function ensureLabelsExist(octokit, owner, repo, labels) {
  const colorMap = {
    'triage:confirmed-bug': 'd73a4a',
    'triage:feature-request': 'a2eeef',
    'triage:not-feasible': 'e4e669',
    'triage:spam': 'cfd3d7',
    'triage:needs-info': 'd876e3',
    'severity:critical': 'b60205',
    'severity:high': 'e4e669',
    'severity:medium': '0075ca',
    'severity:low': 'cfd3d7',
  }
  for (const label of labels) {
    try {
      await octokit.rest.issues.getLabel({ owner, repo, name: label })
    } catch {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name: label,
        color: colorMap[label] ?? 'ededed',
      })
    }
  }
}

run().catch(core.setFailed)
