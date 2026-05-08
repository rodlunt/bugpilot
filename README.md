# bugpilot

Drop-in feedback and bug-capture widget with structured issue creation, AI triage via Claude, and NTFY action notifications.

## What it does

1. **Capture** — a lightweight widget embeds in any web app. Users submit a bug report or feature request; the widget auto-collects viewport, browser, OS, and URL context plus an optional screenshot.
2. **Create** — a structured GitHub issue is created with all captured data in a consistent machine-readable format. Screenshots are committed to a `bug-report-screenshots` branch and embedded as images.
3. **Triage** — a reusable Claude GitHub Action fires on every new issue. Bugs are classified, severity assessed, and a proposed fix drafted. Feature requests receive a simple acknowledgement. A comment is posted and triage labels are applied automatically.
4. **Notify** — an NTFY push notification is sent to the site owner with the proposed fix summary and two action buttons: 🟢 Approve (triggers apply-fix workflow) and 🔴 Manual review (opens the issue).

## Widget: two report paths

The widget presents two tabs:

**Bug / Usability:** what happened, expected behaviour, steps to reproduce (optional), frequency, impact.

**Feature / Feedback:** what would you like, why do you need it (optional), priority.

## Design goals

- **Drop-in, minimal setup.** One script tag. One config object. Works.
- **Theme-agnostic.** CSS custom properties inherit from the host app; the widget looks native.
- **BYO API key.** The triage Action is a reusable GitHub Action — consumers supply their own `ANTHROPIC_API_KEY`.
- **No external CDN required.** Screenshots are stored in a branch of your own repo.

## Status

M1, M2, and M3 complete. Widget, Worker, triage Action, and apply-fix workflow are all working end-to-end. See [PLANNING.md](./PLANNING.md) for the full roadmap.

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
#   GITHUB_TOKEN=<classic PAT with repo scope>
#   GITHUB_REPO=owner/repo
#   ALLOWED_ORIGIN=http://localhost:5173
npx wrangler dev   # local dev on localhost:8787
npx wrangler deploy
```

**Triage Action (consumers):**

Add to your repo's workflow:
```yaml
- uses: rodlunt/bugpilot/actions/triage@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    ntfy-topic: ${{ secrets.NTFY_TOPIC }}                    # optional
    webhook-secret: ${{ secrets.WEBHOOK_SECRET }}            # optional, for apply-fix
    bugpilot-worker-url: ${{ secrets.BUGPILOT_WORKER_URL }}  # optional, for apply-fix
```

**Apply-fix Action (consumers):**

Add to your repo's workflow — triggered by `workflow_dispatch` with an `issue_number` input, or automatically via the NTFY 🟢 Approve button once the Worker is deployed:
```yaml
- uses: rodlunt/bugpilot/actions/apply-fix@v1
  with:
    issue-number: ${{ github.event.inputs.issue_number }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    ntfy-topic: ${{ secrets.NTFY_TOPIC }}                    # optional
```

Also required: **Settings → Actions → General → tick "Allow GitHub Actions to create and approve pull requests".**

**GitHub Actions secrets (this repo):**

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for triage and apply-fix |
| `NTFY_TOPIC` | Full NTFY topic URL |
| `WEBHOOK_SECRET` | Shared secret for the Worker `/webhook/apply-fix` endpoint |
| `BUGPILOT_WORKER_URL` | Deployed Worker base URL — wires the 🟢 Approve NTFY button |

**Worker secrets (set via `wrangler secret put`):**

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Classic PAT with `repo` scope |
| `GITHUB_REPO` | `owner/repo` |
| `WEBHOOK_SECRET` | Same value as the GitHub Actions secret above |

## Licence

TBD — likely MIT for the widget, proprietary for a future hosted tier.
