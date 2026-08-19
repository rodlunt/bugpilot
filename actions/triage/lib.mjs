// Pure helpers, extracted so they can be unit-tested: index.mjs executes
// run() on import, which makes it untestable directly.

export function parseStructuredBlock(body) {
  if (!body) return null
  // Take the LAST match: the worker appends the genuine block at the end of
  // the issue body, so a marker smuggled into user-supplied text (which sits
  // above it) can never shadow it. The worker also neutralises the markers
  // in user text; this is the parser-side half of the same defence.
  const matches = [...body.matchAll(/<!-- bugpilot:structured\n([\s\S]*?)\nbugpilot:end -->/g)]
  if (!matches.length) return null
  try {
    return JSON.parse(matches[matches.length - 1][1])
  } catch {
    return null
  }
}

export function buildUserMessage(issue, structured) {
  const structuredBlock = structured
    ? `\n\nMachine-readable context:\n\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\``
    : ''

  return `Issue #${issue.number}: ${issue.title}\n\n${issue.body}${structuredBlock}`
}

export function buildComment(triage) {
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

export function deriveLabels(triage) {
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

export function ntfyServerAndTopic(topicUrl) {
  let resolved = topicUrl
  if (!resolved.includes('://')) {
    const firstSegment = resolved.split('/')[0]
    resolved = firstSegment.includes('.') ? `https://${resolved}` : `https://ntfy.sh/${resolved}`
  }
  const u = new URL(resolved)
  return { server: `${u.protocol}//${u.host}`, topic: u.pathname.replace(/^\//, '') }
}
