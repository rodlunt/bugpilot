# bugpilot

Drop-in feedback and bug-capture widget with structured issue creation, AI triage via Claude, and NTFY action notifications.

## What it does

1. **Capture** — a lightweight widget embeds in any web app. Users submit a bug report or feature request; the widget auto-collects viewport, browser, OS, and URL context plus an optional screenshot.
2. **Create** — a structured GitHub issue is created with all captured data in a consistent machine-readable format. Screenshots are committed to a `bug-report-screenshots` branch and embedded as images.
3. **Triage** — a Claude GitHub Action fires on every widget-submitted issue. Bugs are classified, severity assessed, and a proposed fix drafted. Feature requests receive a simple acknowledgement. A comment is posted and triage labels are applied automatically.
4. **Notify** — an NTFY push notification is sent with the proposed fix summary and two action buttons: 🟢 Approve (triggers the apply-fix workflow) and 🔴 Manual review (opens the issue).
5. **Fix** — the apply-fix workflow runs a Claude agentic loop that reads the repo, implements the fix, and opens a PR. A follow-up NTFY is sent when the PR is ready.

## Widget: two report paths

**Bug / Usability:** what happened, expected behaviour, steps to reproduce (optional), frequency, impact.

**Feature / Feedback:** what would you like, why do you need it (optional), priority.

## Design goals

- **Drop-in, minimal setup.** One script tag. One config object. Works.
- **Theme-agnostic.** CSS custom properties inherit from the host app; the widget looks native.
- **BYO API key.** The Actions are reusable GitHub Actions — consumers supply their own `ANTHROPIC_API_KEY`.
- **No external CDN required.** Screenshots are stored in a branch of your own repo.
- **No laptop required.** The full pipeline from user report to merged fix can run without touching a laptop.

## Status

M1, M2, and M3 complete and working end-to-end.

## Getting started (development)

**Widget:**
```bash
cd widget && npm install
npm run dev        # opens test harness at localhost:5173
npm run build      # produces dist/bugpilot.es.js, .umd.js, .iife.js
```

**Cloudflare Worker:**
```bash
cd backend && npm install
# Create backend/.dev.vars with:
#   GITHUB_TOKEN=<PAT — see secrets table below for required scopes>
#   GITHUB_REPO=owner/repo
#   ALLOWED_ORIGIN=http://localhost:5173
npx wrangler dev   # local dev on localhost:8787
npx wrangler deploy
```

**Triage Action (consumers):**

Add to your repo's workflow:
```yaml
- uses: rodlunt/bugpilot/actions/triage@main
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    ntfy-topic: ${{ secrets.NTFY_TOPIC }}                    # optional
    webhook-secret: ${{ secrets.WEBHOOK_SECRET }}            # optional, for apply-fix
    bugpilot-worker-url: ${{ secrets.BUGPILOT_WORKER_URL }}  # optional, for apply-fix
```

**Apply-fix Action (consumers):**

Add to your repo's workflow — triggered by `workflow_dispatch` with an `issue_number` input, or automatically via the NTFY 🟢 Approve button once the Worker is deployed:
```yaml
- uses: rodlunt/bugpilot/actions/apply-fix@main
  with:
    issue-number: ${{ github.event.inputs.issue_number }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    ntfy-topic: ${{ secrets.NTFY_TOPIC }}                    # optional
```

Also required: **Settings → Actions → General → tick "Allow GitHub Actions to create and approve pull requests".**

**GitHub Actions secrets (consumer repo):**

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for triage and apply-fix |
| `NTFY_TOPIC` | Full NTFY topic URL (e.g. `https://ntfy.sh/your-topic`) |
| `WEBHOOK_SECRET` | Shared secret for the Worker `/webhook/apply-fix` endpoint |
| `BUGPILOT_WORKER_URL` | Deployed Worker base URL — wires the 🟢 Approve NTFY button |

**Worker secrets (set via `wrangler secret put`):**

| Secret | Purpose | Required PAT scopes |
|---|---|---|
| `GITHUB_TOKEN` | Creates issues, commits screenshots, dispatches workflows | Classic PAT: `repo` + `workflow`. Fine-grained: Contents (R/W), Issues (R/W), Actions (R/W) |
| `GITHUB_REPO` | Target repo as `owner/repo` | — |
| `WEBHOOK_SECRET` | Same value as the Actions secret above | — |

## Licence

TBD — likely MIT for the widget, proprietary for a future hosted tier.
