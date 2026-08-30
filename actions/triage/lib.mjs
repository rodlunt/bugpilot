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

// House style guard for prose the model produces. The system prompt asks
// for Australian English, no em or en dashes and no exclamation marks, but
// the model does not always comply, so the mechanical part is enforced
// here. A dash is replaced with ", " (a comma or colon rewrite cannot be
// done mechanically, and a comma reads correctly in almost every case) and
// a sentence-ending exclamation mark becomes a full stop. Banned words are
// not rewritten: there is no safe mechanical substitute for a word, so the
// prompt is the only defence for those.
export function houseStyle(text) {
  if (typeof text !== 'string') return text
  return text
    // A spaced dash ("a — b", "a – b") collapses to a comma with one space.
    .replace(/\s*[—–]\s*/g, ', ')
    // A comma we just produced directly after another comma or a colon
    // is noise: "however, , b" and "note: , b".
    .replace(/([,:])\s*,\s+/g, '$1 ')
    // A run of exclamation marks at the end of a sentence becomes one full stop.
    .replace(/!+(?=\s|$|["')\]])/g, '.')
}

export function applyHouseStyle(triage) {
  if (!triage || typeof triage !== 'object') return triage
  const out = { ...triage }
  for (const key of ['proposed_fix', 'response_draft']) {
    if (typeof out[key] === 'string') out[key] = houseStyle(out[key])
  }
  return out
}
