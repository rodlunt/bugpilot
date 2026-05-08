# Contributing to bugpilot

Thanks for your interest. Here's everything you need to get started.

## Reporting bugs and requesting features

Use the issue templates on the [Issues](https://github.com/rodlunt/bugpilot/issues) tab. If you're running the widget locally, you can also just submit a report via the widget itself — that's the best way to test the pipeline end-to-end.

## Development setup

**Widget** (`widget/`):
```bash
npm install
npm run dev    # Vite dev server at localhost:5173, opens test harness
npm run build  # build all three output formats
```

**Cloudflare Worker** (`backend/`):
```bash
npm install
# create backend/.dev.vars:
#   GITHUB_TOKEN=<PAT with repo + workflow scopes>
#   GITHUB_REPO=owner/repo
#   ALLOWED_ORIGIN=http://localhost:5173
npx wrangler dev
```

**Actions** (`actions/triage/`, `actions/apply-fix/`):
```bash
npm install
npm run build  # compiles index.js → dist/index.js via ncc
```

The action bundles (`dist/index.js`) are committed to the repo. Always rebuild and commit `dist/` after changing `index.js` in either action.

## Making a pull request

1. Fork the repo and create a branch from `main`.
2. Make your change. For the widget, keep it vanilla JS — no framework dependencies.
3. If you changed an action's `index.js`, run `npm run build` in that action's directory and commit the updated `dist/index.js`.
4. Open a PR against `main` with a clear description of what changed and why.

## Commit style

Conventional commits: `type(scope): description`. Types: `feat`, `fix`, `chore`, `docs`, `refactor`. Keep the first line under 72 characters.

## Key constraints

- **Widget must stay vanilla JS.** No React, Vue, or any framework. It needs to embed in any host app without dependency conflicts.
- **No secrets in source.** GitHub token lives in Worker env vars only, never in widget config or committed files.
- **Rebuild action bundles.** GitHub Actions runs `dist/index.js` directly — if you skip the build step your changes won't take effect.
