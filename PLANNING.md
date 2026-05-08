# bugpilot — architecture and roadmap

**Status:** M1, M2, M3 complete and working end-to-end.

---

## Vision

A drop-in product that any web app can add in minutes. The owner gets an AI-triaged GitHub issue and a phone notification with an apply-fix button before the user has closed the feedback dialog.

---

## Components

### 1. Widget (`widget/`)

Vanilla JS, no framework dependencies. Single script tag or npm install.

- Two-path form: Bug/Usability and Feature/Feedback tabs
- Auto-captures URL, viewport, browser, OS, timestamp
- Optional screenshot via `html2canvas`
- POSTs structured payload to configured endpoint
- Theming via CSS custom properties (`--bp-primary`, `--bp-surface`, `--bp-text`, etc.)
- `BugPilot.init({ endpoint, projectName, labels, position })`
- Build: Vite library mode → `dist/bugpilot.es.js` + `dist/bugpilot.iife.js`

### 2. Cloudflare Worker (`backend/`)

Receives the widget POST. Commits screenshot PNG to `bug-report-screenshots` branch via GitHub Contents API. Creates structured GitHub issue with human-readable tables + machine-readable `<!-- bugpilot:structured ... -->` JSON block.

- GitHub token lives in Worker env vars, never exposed client-side
- Anonymous POSTs accepted (ALLOWED_ORIGIN is CORS-only, not auth)
- Bug issues get `user-feedback` + `bug` labels; feature requests get `user-feedback` + `enhancement`
- Also exposes `POST /webhook/apply-fix` — validates `x-webhook-secret`, dispatches `apply-fix` workflow via GitHub Actions API

### 3. Triage Action (`actions/triage/`)

Triggered on `issues.opened`. Guard: `contains(github.event.issue.body, '<!-- bugpilot:structured')` so it only fires for widget-submitted issues.

- Bug reports: calls Claude API with triage prompt, expects structured JSON (classification, severity, proposed_fix, response_draft), posts comment, applies triage/severity labels
- Feature requests: posts simple acknowledgement comment without calling Claude
- Sends NTFY notification: bugs get 🟢 Approve + 🔴 Manual review; features get 🔵 View request
- Approve button calls Worker `/webhook/apply-fix` via NTFY HTTP action

### 4. Apply-fix Action (`actions/apply-fix/`)

Triggered by `workflow_dispatch` with `issue_number` input (called by Worker webhook from NTFY Approve button).

- Claude agentic loop: `list_files`, `read_file`, `write_file`, `report_done` tools; max 20 iterations; max_tokens 8192
- Tracks `legitimateWrites` Set — only Claude-written files are staged (no garbage staging)
- All git commands use `execFileSync` to avoid shell injection from backtick/quote in summaries
- Creates `fix/issue-N` branch, commits, opens PR, sends NTFY "Fix ready"
- Graceful fallback if PR creation blocked (403): posts compare URL with instructions

---

## Milestones

### M1 — Widget + structured issue creation ✅
- Widget JS: trigger button, two-path form, context capture, screenshot, POST
- Cloudflare Worker: receive POST, commit screenshot to branch, create structured GitHub issue
- Theming via CSS custom properties, test harness at `widget/test/index.html`

### M2 — Claude triage Action ✅
- Triage `action.yml` + workflow, triggered only for widget-submitted issues
- Structured JSON output from Claude (classification, severity, proposed_fix)
- Label application, NTFY notification with action buttons

### M3 — Apply-fix loop ✅
- `apply-fix.yml` workflow triggered by NTFY action webhook via Worker
- Claude agentic loop reads repo, implements fix, commits to branch
- PR opened, follow-up NTFY sent

### M4 — Portability
- [ ] Tag `v1` release on GitHub
- [ ] Verify consumers can use `uses: rodlunt/bugpilot/actions/triage@v1`
- [ ] Per-action README explaining how to wire up
- [ ] Integration guide for non-bundled apps (script tag, Hugo sites)

### M5 — Polish for external use (future)
- [ ] Hosted backend option (no Worker self-hosting required)
- [ ] npm publish (`bugpilot-widget`)
- [ ] Landing page / docs site

---

## Security decisions

- `crypto.subtle.timingSafeEqual` for webhook secret comparison in Worker
- `safePath` in apply-fix rejects paths outside REPO_ROOT and paths that resolve to REPO_ROOT itself
- Integer validation for `issue_number` (`Number.isInteger && > 0`)
- No secrets in widget config; GitHub token lives only in Worker env vars
