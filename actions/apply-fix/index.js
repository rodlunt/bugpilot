const core = require('@actions/core')
const github = require('@actions/github')
const Anthropic = require('@anthropic-ai/sdk')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const REPO_ROOT = process.cwd()
const MAX_ITERATIONS = 20

const SYSTEM_PROMPT = `You are a senior engineer implementing a fix for a reported bug.
You have access to the full repository via read_file, write_file, and list_files tools.

Your job:
1. Explore the relevant code using list_files and read_file
2. Understand the bug and the triage team's proposed fix
3. Implement the minimal change that resolves the bug
4. Call report_done with a concise summary of what you changed

Rules:
- Read files before modifying them
- Make the smallest change that fixes the bug — do not refactor unrelated code
- Do not modify package.json, package-lock.json, or any lockfiles
- Do not modify test files unless the bug is in a test
- If the issue lacks enough information to implement a fix confidently, explain why in report_done without modifying any files`

async function run() {
  const issueNumber = parseInt(core.getInput('issue-number', { required: true }), 10)
  const apiKey = core.getInput('anthropic-api-key', { required: true })
  const token = core.getInput('github-token')
  const model = core.getInput('model') || 'claude-sonnet-4-6'
  const ntfyTopic = core.getInput('ntfy-topic')

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  core.info(`Starting apply-fix for issue #${issueNumber} in ${owner}/${repo}`)

  const { data: issue } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber })

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  })
  const triageComment = comments.find((c) => c.body?.includes('### bugpilot triage'))

  const prompt = buildPrompt(issue, triageComment)

  core.info('Running Claude agentic loop for fix implementation...')
  const client = new Anthropic.default({ apiKey })
  const result = await runAgenticLoop(client, model, prompt)

  if (!result) {
    core.setFailed('Claude did not produce a fix result')
    return
  }

  core.info(`Fix summary: ${result.summary}`)

  execSync('git config user.name "github-actions[bot]"')
  execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"')

  // Authenticate git push via token
  execSync(
    `git remote set-url origin https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
    { stdio: 'pipe' },
  )

  const branchName = `fix/issue-${issueNumber}`

  // Clean up any existing remote branch from a previous attempt
  try {
    execSync(`git push origin --delete ${branchName}`, { stdio: 'pipe' })
    core.info(`Deleted existing remote branch ${branchName}`)
  } catch {
    // Branch didn't exist — that's fine
  }

  execSync(`git checkout -b ${branchName}`)

  execSync('git add -A')

  const stagedFiles = execSync('git diff --cached --name-only').toString().trim()
  if (!stagedFiles) {
    core.warning('Claude did not modify any files')
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: [
        '### bugpilot apply-fix',
        '',
        '**Status:** No files were modified.',
        '',
        result.summary,
      ].join('\n'),
    })
    return
  }

  core.info(`Staged files:\n${stagedFiles}`)
  execSync(
    `git commit -m "fix(#${issueNumber}): ${result.summary.replace(/"/g, "'").slice(0, 72)}"`,
  )
  execSync(`git push origin ${branchName}`)

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `fix(#${issueNumber}): ${result.summary.slice(0, 72)}`,
    head: branchName,
    base: 'main',
    body: [
      `Fixes #${issueNumber}`,
      '',
      result.summary,
      '',
      '*Implemented by bugpilot + Claude*',
    ].join('\n'),
  })

  core.info(`PR opened: ${pr.html_url}`)
  core.setOutput('pr-url', pr.html_url)
  core.setOutput('branch', branchName)

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: [
      '### bugpilot apply-fix',
      '',
      `**Status:** Fix implemented — PR ready for review.`,
      `**Branch:** \`${branchName}\``,
      `**Files changed:** ${stagedFiles.split('\n').length}`,
      '',
      `**Summary:** ${result.summary}`,
      '',
      `[View PR →](${pr.html_url})`,
    ].join('\n'),
  })

  if (ntfyTopic) {
    await sendNtfy({ ntfyTopic, issue, pr })
  }
}

async function runAgenticLoop(client, model, prompt) {
  const messages = [{ role: 'user', content: prompt }]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: buildTools(),
      messages,
    })

    core.info(`Iteration ${i + 1}: stop_reason=${response.stop_reason}`)

    // report_done signals the end of the agentic loop
    const doneCall = response.content.find(
      (b) => b.type === 'tool_use' && b.name === 'report_done',
    )
    if (doneCall) {
      // Still need to return the tool_result so the conversation is valid
      messages.push({ role: 'assistant', content: response.content })
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: doneCall.id,
            content: 'Acknowledged.',
          },
        ],
      })
      return { summary: doneCall.input.summary }
    }

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return { summary: text.slice(0, 300) || 'Fix implemented' }
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use')
    if (!toolUses.length) {
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return { summary: text.slice(0, 300) || 'Fix implemented' }
    }

    messages.push({ role: 'assistant', content: response.content })

    const toolResults = []
    for (const toolUse of toolUses) {
      let result
      try {
        result = executeTool(toolUse.name, toolUse.input)
        core.info(
          `  ${toolUse.name}(${JSON.stringify(toolUse.input)}) → ${String(result).slice(0, 120)}`,
        )
      } catch (err) {
        result = `Error: ${err.message}`
        core.warning(`  ${toolUse.name} failed: ${err.message}`)
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: String(result),
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  core.warning(`Reached max iterations (${MAX_ITERATIONS})`)
  return { summary: 'Fix implemented (max iterations reached)' }
}

function executeTool(name, input) {
  switch (name) {
    case 'read_file': {
      const abs = safePath(input.path)
      if (!fs.existsSync(abs)) return `File not found: ${input.path}`
      const content = fs.readFileSync(abs, 'utf8')
      // Guard against enormous files filling context
      if (content.length > 100_000) {
        return content.slice(0, 100_000) + '\n\n[... file truncated at 100 000 chars ...]'
      }
      return content
    }
    case 'write_file': {
      const abs = safePath(input.path)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, input.content, 'utf8')
      return `Written: ${input.path} (${input.content.length} chars)`
    }
    case 'list_files': {
      const abs = safePath(input.path || '.')
      if (!fs.existsSync(abs)) return `Directory not found: ${input.path}`
      const stat = fs.statSync(abs)
      if (!stat.isDirectory()) return `Not a directory: ${input.path}`
      const SKIP = new Set(['node_modules', '.git', '.wrangler', 'dist', '.dev.vars'])
      const entries = fs.readdirSync(abs, { withFileTypes: true })
      return (
        entries
          .filter((e) => !SKIP.has(e.name))
          .map((e) => `${e.isDirectory() ? '[dir] ' : '[file]'} ${e.name}`)
          .join('\n') || '(empty)'
      )
    }
    case 'report_done':
      return `Acknowledged: ${input.summary}`
    default:
      return `Unknown tool: ${name}`
  }
}

function safePath(filePath) {
  const resolved = path.resolve(REPO_ROOT, filePath)
  const boundary = REPO_ROOT + path.sep
  if (resolved !== REPO_ROOT && !resolved.startsWith(boundary)) {
    throw new Error(`Path traversal rejected: ${filePath}`)
  }
  return resolved
}

function buildTools() {
  return [
    {
      name: 'read_file',
      description: 'Read the full contents of a file. Use this before writing to understand existing code.',
      input_schema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Relative path from repo root, e.g. "src/widget.js"' },
        },
      },
    },
    {
      name: 'write_file',
      description: 'Write (or overwrite) a file with new content. Always read_file first.',
      input_schema: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: 'Relative path from repo root' },
          content: { type: 'string', description: 'Complete new file content' },
        },
      },
    },
    {
      name: 'list_files',
      description: 'List files and subdirectories at a given path. Use to explore the repo structure.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to list (defaults to repo root if omitted)',
          },
        },
      },
    },
    {
      name: 'report_done',
      description:
        'Call this when you have finished implementing the fix (or determined one is not possible). This ends the session.',
      input_schema: {
        type: 'object',
        required: ['summary'],
        properties: {
          summary: {
            type: 'string',
            description:
              'One or two sentences describing what was changed (or why no change was made)',
          },
        },
      },
    },
  ]
}

function buildPrompt(issue, triageComment) {
  const parts = [
    `## Bug report — Issue #${issue.number}`,
    '',
    `**Title:** ${issue.title}`,
    '',
    '**Body:**',
    issue.body || '(no body)',
  ]

  if (triageComment) {
    parts.push('', '## Triage analysis', '', triageComment.body)
  }

  parts.push(
    '',
    '## Your task',
    '',
    'Implement the fix described above.',
    'Start by exploring the repository with list_files, read the relevant files,',
    'then make the targeted change and call report_done.',
  )

  return parts.join('\n')
}

async function sendNtfy({ ntfyTopic, issue, pr }) {
  const topic = ntfyTopic.replace(/^https?:\/\/ntfy\.sh\//, '')
  const payload = {
    topic,
    title: `Fix ready: #${issue.number}`,
    message: `PR opened for "${issue.title.slice(0, 80)}". Ready to review and merge.`,
    actions: [
      { action: 'view', label: '🔍 Review PR', url: pr.html_url },
      { action: 'view', label: '📋 View issue', url: issue.html_url },
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
    core.info('NTFY follow-up notification sent')
  }
}

run().catch(core.setFailed)
