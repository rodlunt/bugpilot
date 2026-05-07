export interface Env {
  SCREENSHOTS: R2Bucket
  GITHUB_TOKEN: string
  GITHUB_REPO: string       // "owner/repo"
  ALLOWED_ORIGIN: string    // "*" or specific origin
}

interface SubmissionPayload {
  description: string
  category?: string | null
  screenshot?: string | null  // base64 data URL
  projectName?: string
  labels?: string[]
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
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? ''
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN === '*' ? '*' : (origin || '*'),
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

  const [owner, repo] = env.GITHUB_REPO.split('/')
  if (!owner || !repo) {
    return jsonError('Worker misconfigured: GITHUB_REPO must be "owner/repo"', 500, corsHeaders)
  }

  // Upload screenshot to R2 if provided
  let screenshotUrl: string | null = null
  if (body.screenshot) {
    screenshotUrl = await uploadScreenshot(body.screenshot, env)
  }

  // Build the GitHub issue
  const issueTitle = buildTitle(body)
  const issueBody = buildIssueBody(body, screenshotUrl)
  const labels = ['user-feedback', ...(body.labels ?? [])]

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

async function uploadScreenshot(dataUrl: string, env: Env): Promise<string | null> {
  try {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const key = `screenshots/${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    await env.SCREENSHOTS.put(key, bytes, { httpMetadata: { contentType: 'image/png' } })
    // Public bucket URL — consumers must enable R2 public access for their bucket
    return `https://pub-REPLACE_WITH_YOUR_R2_ACCOUNT_ID.r2.dev/${key}`
  } catch (err) {
    console.error('[bugpilot] R2 screenshot upload failed', err)
    return null
  }
}

function buildTitle(body: SubmissionPayload): string {
  const prefix = body.projectName ? `[${body.projectName}] ` : ''
  const category = body.category ? `${body.category}: ` : ''
  const desc = body.description.slice(0, 72)
  return `${prefix}${category}${desc}${body.description.length > 72 ? '…' : ''}`
}

function buildIssueBody(body: SubmissionPayload, screenshotUrl: string | null): string {
  const ctx = body.context

  const screenshotSection = screenshotUrl
    ? `## Screenshot\n\n![Screenshot](${screenshotUrl})\n`
    : ''

  const structured = JSON.stringify({
    url: ctx.url,
    viewport: ctx.viewport,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    os: ctx.os,
    timestamp: ctx.timestamp,
    timezone: ctx.timezone ?? null,
    language: ctx.language ?? null,
    referrer: ctx.referrer ?? null,
    category: body.category ?? null,
    projectName: body.projectName ?? null,
    screenshotUrl,
  })

  return `## User report

${body.description}

## Context

| Field | Value |
|---|---|
| URL | ${ctx.url} |
| Viewport | ${ctx.viewport.w}×${ctx.viewport.h} |
| Browser | ${ctx.browser} |
| OS | ${ctx.os} |
| Timestamp | ${ctx.timestamp} |
| Project | ${body.projectName ?? '—'} |
| Category | ${body.category ?? '—'} |

${screenshotSection}
<!-- bugpilot:structured
${structured}
bugpilot:end -->
`
}

function jsonError(message: string, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
