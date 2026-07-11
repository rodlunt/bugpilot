export interface Env {
  GITHUB_TOKEN: string
  GITHUB_REPO: string
  ALLOWED_ORIGIN: string
  WEBHOOK_SECRET?: string
  APPLY_FIX_WORKFLOW?: string
}

interface SubmissionPayload {
  type?: 'bug' | 'feature'
  description: string
  screenshot?: string | null
  projectName?: string
  context: {
    url: string
    viewport: { w: number; h: number }
    userAgent: string
    browser: string
    os: string
    timestamp: string
    timezone?: string
    language?: string
    referrer?: string | null
  }
  // Bug-specific
  bugCategory?: string | null
  expectedBehavior?: string | null
  stepsToReproduce?: string | null
  frequency?: string | null
  impact?: string | null
  // Feature-specific
  problemStatement?: string | null
  priority?: string | null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestOrigin = request.headers.get('Origin') ?? ''
    const allowed = env.ALLOWED_ORIGIN === '*' ? ['*'] : env.ALLOWED_ORIGIN.split(',').map(s => s.trim())
    const corsOrigin = allowed.includes('*') ? '*' : (allowed.includes(requestOrigin) ? requestOrigin : allowed[0])
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/feedback') {
      return handleFeedback(request, env, corsHeaders)
    }

    if (request.method === 'POST' && url.pathname === '/webhook/apply-fix') {
      return handleApplyFix(request, env, corsHeaders)
    }

    return new Response('Not found', { status: 404, headers: corsHeaders })
  },
}

async function handleFeedback(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  let body: SubmissionPayload
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400, corsHeaders)
  }

  if (!body.description?.trim()) {
    return jsonError('description is required', 400, corsHeaders)
  }

  // The widget always sends context, but hand-rolled payloads (curl tests,
  // third-party integrations) may omit it. Without this guard the body
  // builders throw on ctx.url / ctx.viewport.w and the caller sees a generic
  // Cloudflare 1101 that is indistinguishable from a bad GITHUB_TOKEN.
  if (typeof body.context !== 'object' || body.context === null) {
    return jsonError('context object is required (url, viewport, userAgent, browser, os, timestamp)', 400, corsHeaders)
  }
  if (typeof body.context.viewport !== 'object' || body.context.viewport === null) {
    return jsonError('context.viewport is required ({w, h})', 400, corsHeaders)
  }

  const [owner, repo] = env.GITHUB_REPO.split('/')
  if (!owner || !repo) {
    return jsonError('Worker misconfigured: GITHUB_REPO must be "owner/repo"', 500, corsHeaders)
  }

  let screenshotUrl: string | null = null
  if (body.screenshot) {
    if (body.screenshot.length > 4_000_000) {
      return jsonError('Screenshot exceeds maximum size', 413, corsHeaders)
    }
    screenshotUrl = await uploadScreenshot(body.screenshot, env)
  }

  const issueTitle = buildTitle(body)
  const issueBody = buildIssueBody(body, screenshotUrl)
  const labels = body.type === 'feature'
    ? ['user-feedback', 'enhancement']
    : ['user-feedback', 'bug']

  await ensureLabelsExist(owner, repo, labels, env.GITHUB_TOKEN)

  const issueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bugpilot-worker/0.1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: issueTitle, body: issueBody, labels }),
  })

  if (!issueRes.ok) {
    const err = await issueRes.text()
    console.error('[bugpilot] GitHub issue creation failed', issueRes.status, err)
    return jsonError('Failed to create GitHub issue', 502, corsHeaders)
  }

  const issue = await issueRes.json() as { html_url: string; number: number }

  return new Response(
    JSON.stringify({ ok: true, issueUrl: issue.html_url, issueNumber: issue.number }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

async function handleApplyFix(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (!env.WEBHOOK_SECRET) {
    return jsonError('Apply-fix webhook not configured on this worker', 503, corsHeaders)
  }

  const secret = request.headers.get('x-webhook-secret') ?? ''
  const expected = env.WEBHOOK_SECRET
  const enc = new TextEncoder()
  const secretBytes = enc.encode(secret.padEnd(expected.length))
  const expectedBytes = enc.encode(expected.padEnd(secret.length))
  const secretsMatch =
    secret.length === expected.length &&
    (await crypto.subtle.timingSafeEqual(secretBytes, expectedBytes))
  if (!secretsMatch) {
    return jsonError('Unauthorized', 401, corsHeaders)
  }

  let body: { issue_number: unknown; owner: unknown; repo: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400, corsHeaders)
  }

  if (
    !Number.isInteger(body.issue_number) ||
    (body.issue_number as number) <= 0 ||
    typeof body.owner !== 'string' ||
    typeof body.repo !== 'string' ||
    !body.owner ||
    !body.repo
  ) {
    return jsonError('Missing or invalid fields: issue_number (positive int), owner, repo', 400, corsHeaders)
  }

  const issueNumber = body.issue_number as number
  const owner = body.owner as string
  const repo = body.repo as string

  const [configOwner, configRepo] = env.GITHUB_REPO.split('/')
  if (owner !== configOwner || repo !== configRepo) {
    return jsonError('Repo mismatch', 403, corsHeaders)
  }

  const workflowFile = env.APPLY_FIX_WORKFLOW || 'apply-fix.yml'
  const dispatchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bugpilot-worker/0.1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { issue_number: String(issueNumber) },
      }),
    },
  )

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text()
    console.error('[bugpilot] workflow_dispatch failed', dispatchRes.status, text)
    return jsonError('Failed to trigger apply-fix workflow', 502, corsHeaders)
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const LABEL_DEFAULTS: Record<string, { color: string; description: string }> = {
  'user-feedback': { color: '0075ca', description: 'Submitted via bugpilot feedback widget' },
  'bug':           { color: 'd73a4a', description: 'Something is not working' },
  'enhancement':   { color: 'a2eeef', description: 'New feature or request' },
}

async function ensureLabelsExist(owner: string, repo: string, labels: string[], token: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'bugpilot-worker/0.1',
    'Content-Type': 'application/json',
  }
  await Promise.all(labels.map(async (name) => {
    const check = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, { headers })
    if (check.status === 404) {
      const defaults = LABEL_DEFAULTS[name] ?? { color: 'ededed', description: '' }
      await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, ...defaults }),
      })
    }
  }))
}

const SCREENSHOTS_BRANCH = 'bug-report-screenshots'

async function uploadScreenshot(dataUrl: string, env: Env): Promise<string | null> {
  try {
    const [owner, repo] = env.GITHUB_REPO.split('/')
    const match = dataUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,/)
    if (!match) {
      console.error('[bugpilot] screenshot rejected: unsupported MIME type')
      return null
    }
    const base64 = dataUrl.slice(match[0].length)
    const filename = `screenshots/${crypto.randomUUID()}.png`
    const headers = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bugpilot-worker/0.1',
      'Content-Type': 'application/json',
    }

    await ensureScreenshotsBranch(owner, repo, headers)

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `chore: add screenshot`,
        content: base64,
        branch: SCREENSHOTS_BRANCH,
      }),
    })

    if (!res.ok) {
      console.error('[bugpilot] screenshot commit failed', res.status, await res.text())
      return null
    }

    return `https://github.com/${owner}/${repo}/raw/${SCREENSHOTS_BRANCH}/${filename}`
  } catch (err) {
    console.error('[bugpilot] screenshot upload failed', err)
    return null
  }
}

async function ensureScreenshotsBranch(owner: string, repo: string, headers: Record<string, string>): Promise<void> {
  const check = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${SCREENSHOTS_BRANCH}`, { headers })
  if (check.ok) return

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  const repoData = await repoRes.json() as { default_branch: string }

  const shaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${repoData.default_branch}`, { headers })
  const shaData = await shaRes.json() as { object: { sha: string } }

  await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${SCREENSHOTS_BRANCH}`, sha: shaData.object.sha }),
  })
}

function buildTitle(body: SubmissionPayload): string {
  const prefix = body.projectName ? `[${body.projectName}] ` : ''
  const typeLabel = body.type === 'feature' ? 'Feature: ' : 'Bug: '
  const desc = body.description.slice(0, 72)
  return `${prefix}${typeLabel}${desc}${body.description.length > 72 ? '…' : ''}`
}

function buildIssueBody(body: SubmissionPayload, screenshotUrl: string | null): string {
  return body.type === 'feature'
    ? buildFeatureBody(body, screenshotUrl)
    : buildBugBody(body, screenshotUrl)
}

function buildBugBody(body: SubmissionPayload, screenshotUrl: string | null): string {
  const ctx = body.context

  const stepsSection = body.stepsToReproduce
    ? `## Steps to reproduce\n\n${body.stepsToReproduce}\n\n`
    : ''

  const screenshotSection = screenshotUrl
    ? `## Screenshot\n\n![Screenshot](${screenshotUrl})\n\n`
    : ''

  const structured = JSON.stringify({
    type: 'bug',
    url: ctx.url,
    viewport: ctx.viewport,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    os: ctx.os,
    timestamp: ctx.timestamp,
    timezone: ctx.timezone ?? null,
    language: ctx.language ?? null,
    referrer: ctx.referrer ?? null,
    bugCategory: body.bugCategory ?? null,
    expectedBehavior: body.expectedBehavior ?? null,
    stepsToReproduce: body.stepsToReproduce ?? null,
    frequency: body.frequency ?? null,
    impact: body.impact ?? null,
    projectName: body.projectName ?? null,
    screenshotUrl,
  })

  return `## What happened

${body.description}

## Expected behaviour

${body.expectedBehavior || '—'}

${stepsSection}## Details

| Field | Value |
|---|---|
| Category | ${body.bugCategory || '—'} |
| Frequency | ${formatFrequency(body.frequency)} |
| Impact | ${formatImpact(body.impact)} |

## Environment

| Field | Value |
|---|---|
| URL | ${ctx.url} |
| Viewport | ${ctx.viewport.w}×${ctx.viewport.h} |
| Browser | ${ctx.browser} |
| OS | ${ctx.os} |
| Timestamp | ${ctx.timestamp} |
| Project | ${body.projectName ?? '—'} |

${screenshotSection}<!-- bugpilot:structured
${structured}
bugpilot:end -->
`
}

function buildFeatureBody(body: SubmissionPayload, screenshotUrl: string | null): string {
  const ctx = body.context

  const whySection = body.problemStatement
    ? `## Problem it solves\n\n${body.problemStatement}\n\n`
    : ''

  const screenshotSection = screenshotUrl
    ? `## Mockup / screenshot\n\n![Screenshot](${screenshotUrl})\n\n`
    : ''

  const structured = JSON.stringify({
    type: 'feature',
    url: ctx.url,
    viewport: ctx.viewport,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    os: ctx.os,
    timestamp: ctx.timestamp,
    timezone: ctx.timezone ?? null,
    language: ctx.language ?? null,
    referrer: ctx.referrer ?? null,
    priority: body.priority ?? null,
    problemStatement: body.problemStatement ?? null,
    projectName: body.projectName ?? null,
    screenshotUrl,
  })

  return `## Feature request

${body.description}

${whySection}## Details

| Field | Value |
|---|---|
| Priority | ${formatPriority(body.priority)} |
| Project | ${body.projectName ?? '—'} |
| URL | ${ctx.url} |
| Submitted | ${ctx.timestamp} |

${screenshotSection}<!-- bugpilot:structured
${structured}
bugpilot:end -->
`
}

function formatFrequency(v: string | null | undefined): string {
  const map: Record<string, string> = {
    'every-time': 'Every time',
    'most-times': 'Most of the time',
    'sometimes': 'Occasionally',
    'once': 'Just once',
  }
  return map[v ?? ''] ?? '—'
}

function formatImpact(v: string | null | undefined): string {
  const map: Record<string, string> = {
    'blocking': 'Blocking — cannot continue',
    'degraded': 'Degraded — workaround exists',
    'cosmetic': 'Minor / cosmetic',
  }
  return map[v ?? ''] ?? '—'
}

function formatPriority(v: string | null | undefined): string {
  const map: Record<string, string> = {
    'critical': 'Critical to my workflow',
    'high': 'Would significantly help',
    'nice': 'Nice to have',
  }
  return map[v ?? ''] ?? '—'
}

function jsonError(message: string, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' } ,
  })
}
