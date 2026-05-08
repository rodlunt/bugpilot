# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

bugpilot is a drop-in feedback and bug-capture product. A user submits a bug report via an embedded widget; a structured GitHub issue is created; a Claude GitHub Action triages it and sends an NTFY phone notification with action buttons (apply fix, dismiss, defer). The "Apply fix" button triggers a second Action that opens a PR.

## Repository layout

```
widget/          Vanilla JS package — the embeddable widget (npm + CDN IIFE script tag)
actions/triage/  GitHub Action — Claude triage on issues.opened
actions/apply-fix/  GitHub Action — creates fix branch + PR via workflow_dispatch
backend/         Cloudflare Worker — receives widget POST, commits screenshot to bug-report-screenshots branch, creates GitHub issue
test/            Minimal plain-HTML test harness for local widget development
```

## Architecture: how the pieces connect

1. **Widget** POSTs a structured payload (user description + auto-captured context + optional html2canvas screenshot as base64) to the configured `endpoint`.
2. **Cloudflare Worker** (`backend/`) receives the POST, commits the screenshot PNG to the `bug-report-screenshots` branch via the GitHub Contents API, then creates a GitHub issue with a structured body. GitHub token lives in Worker env vars, never exposed client-side.
3. **Triage Action** fires on `issues.opened` with the configured label. It parses the machine-readable JSON block in the issue body, calls Claude API, and expects structured JSON back (classification, severity, proposed_fix, response_draft). Posts a comment, applies triage labels, sends NTFY.
4. **Apply-fix Action** is triggered by the NTFY "Apply fix" webhook via `workflow_dispatch`. Asks Claude to implement the fix, opens a PR, sends a follow-up NTFY.

## Key constraints — do not violate

- **Widget must be vanilla JS.** No React, no Vue, no framework dependencies. It needs to drop into any host app with a single script tag.
- **No auth on the widget endpoint.** The Worker accepts anonymous POSTs. The GitHub token is a Worker env var, never in the widget config.
- **Screenshots go to the `bug-report-screenshots` branch, not inline.** GitHub strips `data:` URIs. Screenshots are committed via the GitHub Contents API to a dedicated branch and served as `raw.githubusercontent.com` URLs embedded in the issue body.

## Structured issue body format

The JSON block inside the HTML comment is what the Claude Action parses — keep this contract stable:

```markdown
## User report
{description}

## Context
| Field | Value |
|---|---|
| URL | {url} |
| Viewport | {width}x{height} |
| Browser | {browser} |
| OS | {os} |
| Timestamp | {iso_timestamp} |
| Project | {projectName} |

## Screenshot
![Screenshot]({github_raw_url})

<!-- bugpilot:structured
{"url":"...","viewport":{"w":...,"h":...},"userAgent":"...","timestamp":"...","projectName":"...","screenshotUrl":"..."}
bugpilot:end -->
```

## Widget theming

CSS custom properties only — no Shadow DOM. Scoped `.bp-*` class names. Host app overrides `--bp-primary`, `--bp-surface`, `--bp-text`, `--bp-radius`, `--bp-z-index` etc.

## Widget configuration

```js
BugPilot.init({
  endpoint: 'https://your-worker.workers.dev/feedback',
  projectName: 'My Site',
  labels: ['bug', 'user-feedback'],  // applied to created GitHub issue
  position: 'bottom-right',          // trigger button position
})
```

## Commands

**Widget** (`widget/`):
```bash
npm install
npm run dev     # Vite dev server with test harness
npm run build   # produces dist/bugpilot.es.js (ESM) and dist/bugpilot.iife.js (CDN script tag)
```

**Worker** (`backend/`):
```bash
npm install
npx wrangler dev   # local dev server
npx wrangler deploy
```

## Open decisions

- **npm publish:** M5. For now the package is local/CDN only.
