# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

bugpilot is a drop-in feedback and bug-capture product. A user submits a bug report via an embedded widget; a structured GitHub issue is created; a Claude GitHub Action triages it and sends an NTFY phone notification with action buttons (apply fix, dismiss, defer). The "Apply fix" button triggers a second Action that opens a PR.

## Project status

Early build phase. The folder structure is scaffolded; no code exists yet. See PLANNING.md for full architecture and milestones (M1–M4).

## Repository layout

```
widget/          JS package — the embeddable widget (npm + CDN script tag)
actions/triage/  GitHub Action — Claude triage on issues.opened
actions/apply-fix/  GitHub Action — creates fix branch + PR via workflow_dispatch
backend/         Backend relay — receives widget POST, creates GitHub issue
```

## Architecture: how the pieces connect

1. **Widget** POSTs a structured payload (user description + auto-captured context + optional html2canvas screenshot) to the backend endpoint.
2. **Backend** (MVP: a Flask route; later: Cloudflare Worker) creates a GitHub issue with a structured body. The issue body has a human-readable markdown table AND a machine-readable `<!-- bugpilot:structured {...} bugpilot:end -->` JSON block.
3. **Triage Action** fires on `issues.opened` with the configured label. It parses the JSON block, calls Claude API, and expects structured JSON back (classification, severity, proposed_fix, response_draft). It posts a comment, applies triage labels, and sends an NTFY notification.
4. **Apply-fix Action** is triggered by the NTFY "Apply fix" webhook via `workflow_dispatch`. It asks Claude to implement the proposed fix as a code change, opens a PR, and sends a follow-up NTFY.

## Structured issue body format

The JSON block inside the HTML comment is what the Claude Action parses — keep this contract stable across the widget and Actions:

```markdown
<!-- bugpilot:structured
{"url":"...","viewport":{"w":...,"h":...},"userAgent":"...","timestamp":"...","projectName":"..."}
bugpilot:end -->
```

## Widget theming

CSS custom properties only — no Shadow DOM. Host app overrides `--bp-primary`, `--bp-surface`, `--bp-text`, etc. Scoped class names (`.bp-*`) to avoid collisions.

## Widget configuration

```js
BugPilot.init({
  endpoint: 'https://your-backend/feedback',
  repo: 'owner/repo',
  ntfyTopic: 'my-site-bugs',
  projectName: 'My Site',
  labels: ['bug', 'user-feedback'],
})
```

## Open decisions (check before assuming)

- **Backend for MVP:** Flask route in content-engine vs. standalone Cloudflare Worker. Planning doc recommends Flask first, extract later. Confirm with Rodney before building either.
- **Screenshot:** html2canvas, with known cross-origin image limitations accepted for MVP.
- **Webhook for Apply fix:** GitHub Actions `workflow_dispatch`. Needs a PAT with `workflow` scope or a GitHub App.

## Reference implementation

A capture-only version (form + context, no screenshot, no Claude) exists in the `business-review-360` app. Extract the feedback form component and issue body formatter from there before writing anything from scratch — do not duplicate work that already exists.

## Commands

No build system is scaffolded yet. Once set up, expect:

- `widget/` — Vite or esbuild; `npm run build` produces a single JS bundle for both npm and CDN use.
- `actions/` — Node.js scripts; no compilation step planned.
- `backend/` — Flask; run via the host app's existing dev server.

Update this file when the build system is chosen.
