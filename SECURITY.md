# Security Policy

bugpilot is a solo-maintained widget plus a Cloudflare Worker and two reusable GitHub Actions.
Consumers supply their own `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` and NTFY credentials as secrets in
their own repo or Worker environment; this project never sees them. This policy is scaled to
that: a lightweight private reporting path, not a formal disclosure programme.

## Supported versions

Only the latest tagged release receives security fixes.

| Version | Supported |
|---|---|
| latest `v1` tag | yes |
| anything older, or an untagged checkout of `main` | no |

If you are consuming an older tag, update to the latest before reporting: the issue may already
be fixed. The README's "Getting started" section shows how the reusable Actions are pinned to a
tag rather than `main`.

## Reporting a vulnerability

Please do not open a public GitHub issue for a security problem: that discloses it before a fix
exists.

Report it privately through **GitHub Security Advisories**: use "Report a vulnerability" under
this repository's Security tab, or go directly to
[github.com/rodlunt/bugpilot/security/advisories/new](https://github.com/rodlunt/bugpilot/security/advisories/new).
That opens a private advisory only the maintainer can see.

Please include what you have: the affected component (widget, Worker, triage action or apply-fix
action), the affected version or commit, the class of issue (for example, an injection via
user-submitted report text reaching a GitHub issue body or an LLM prompt, a credential-handling
problem in the Worker, or a supply-chain concern in a committed `dist/index.mjs`), and a
reproduction if you have one.

## What to expect

This is a one-person project, so response times are best-effort, not contractual:

- **Acknowledgement**: within 5 business days of a report arriving.
- **Initial assessment** (severity and a rough plan): within 14 days of acknowledgement.
- **Fix or mitigation**: timeline depends on severity and complexity; you will be told what to
  expect once the report has been triaged.

You will be credited in the fix's release notes if you want to be, and left out if you would
rather not be.
