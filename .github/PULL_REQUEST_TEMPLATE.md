<!-- Thanks for the PR. CONTRIBUTING.md is the two-minute read behind each line here. -->

## What and why

<!-- What changed, and the reason it needed to. The body of your commits should
     already say this; a summary here is fine. -->

Closes #

## Verification

<!-- Name the artefact that proves it works: which build/typecheck you ran, a
     manual check via the widget test harness, a log or screenshot. "It looks
     right" is not verification. -->

## Checklist

- [ ] Ran the relevant local checks and they pass:
      `cd widget && pnpm install && pnpm build`
      `cd backend && pnpm install && pnpm typecheck`
      (for an action: `cd actions/<name> && pnpm install && pnpm build`, and the
      updated `dist/index.js` is committed)
- [ ] Widget changes stay vanilla JS, no framework dependencies
- [ ] No secrets in source; the GitHub token stays in Worker env vars only
- [ ] Commits follow conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- [ ] Australian English, no em or en dashes
