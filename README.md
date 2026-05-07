# bugpilot

Drop-in feedback and bug-capture widget with structured issue creation, AI triage via Claude, and NTFY action notifications.

## What it does

1. **Capture** — a lightweight widget embeds in any web app. Users describe a bug or give feedback, optionally attach a screenshot, and submit. The widget auto-collects viewport, browser, device, and URL context.
2. **Create** — a structured GitHub issue is created with all captured data in a consistent machine-readable format.
3. **Triage** — a Claude GitHub Action reviews the issue: classifies it (bug / feature / spam / not-feasible), checks if it is logical and reproducible, and drafts a proposed fix or response.
4. **Notify** — an NTFY notification is sent with the classification and proposed fix. Action buttons let you apply the fix, dismiss, or defer — directly from your phone.

## Design goals

- **Drop-in, minimal setup.** One script tag. One config object. Works.
- **Theme-agnostic.** CSS custom properties inherit from the host app; the widget looks native.
- **Multi-project.** The widget package is host-agnostic. Each project wires up its own GitHub repo and NTFY topic; the widget doesn't care.
- **Sellable.** The widget + Action + notification loop is a self-contained product. Future: hosted backend option so consumers don't need to self-host.

## Status

M1 in progress. Widget and Cloudflare Worker are scaffolded; not yet wired to a live R2 bucket or deployed. See [PLANNING.md](./PLANNING.md) for the full roadmap.

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
# Set secrets before running:
wrangler secret put GITHUB_TOKEN   # fine-grained PAT: Issues write + Contents write
wrangler secret put GITHUB_REPO    # "owner/repo"
npx wrangler dev                   # local dev server on localhost:8787
npx wrangler deploy
```

**R2 setup (required for screenshots):**
1. Create a bucket named `bugpilot-screenshots` in your Cloudflare dashboard.
2. Enable public access on the bucket to get a `pub-<id>.r2.dev` URL.
3. Replace the placeholder in `backend/src/index.ts` (`uploadScreenshot`) with your actual `pub-<id>.r2.dev` domain.

## Licence

TBD — likely MIT for the widget, proprietary for a future hosted tier.
