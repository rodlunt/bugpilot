# bugpilot — architecture and roadmap

**Status:** planning phase
**Reference app:** business-review-360 (capture-only implementation, no Claude automation)

---

## Vision

A drop-in product that any web app can add in minutes. The owner gets an AI-triaged GitHub issue and a phone notification with an apply-fix button before the user has closed the feedback dialog.

---

## Components

### 1. Widget (client-side JS package)

Embedded in the host app via a single script tag or npm install.

**Responsibilities:**
- Render a floating trigger button (position, icon, label are configurable)
- Open a feedback form (description, optional category selector, optional screenshot)
- Capture context automatically: `navigator.userAgent`, screen/viewport dimensions, `window.location`, referrer, timestamp
- Take a screenshot via `html2canvas` (in-browser, no server round-trip)
- POST the structured payload to the backend endpoint

**Theming:**
- Uses CSS custom properties (`--bp-primary`, `--bp-surface`, `--bp-text`, etc.) with sensible defaults
- Host app overrides any property it cares about; everything else inherits
- No Shadow DOM (easier to theme); scoped class names to avoid collisions

**Configuration (one object at init time):**
```js
BugPilot.init({
  endpoint: 'https://your-backend/feedback',  // or GitHub directly via token
  repo: 'rodlunt/my-site',                    // GitHub repo for issues
  ntfyTopic: 'my-site-bugs',                  // optional, for direct NTFY
  projectName: 'My Site',                     // displayed in issue title
  labels: ['bug', 'user-feedback'],            // GitHub labels to apply
})
```

**Distribution:**
- npm package (`bugpilot-widget`) — import in bundled apps
- CDN script tag (`unpkg` / own CDN) — for Hugo sites and non-bundled apps
- Both point to the same built JS

---

### 2. Backend endpoint (lightweight relay)

Receives the widget POST and creates the GitHub issue. Needed because GitHub tokens must not be exposed client-side.

**Options (pick one per deployment):**

| Option | Pros | Cons |
|---|---|---|
| Cloudflare Worker | Zero infra, cheap, global edge | CF account required |
| Existing Flask app route | No new infra for apps that already have a server | Couples widget to host app |
| Hosted bugpilot service (future) | Zero setup for consumer | Requires running a service |

**MVP recommendation:** add a route to the existing Flask app for content-engine / BR360. Extract to a standalone Cloudflare Worker when the first external consumer arrives.

**Issue body format (structured, machine-readable by Claude Action):**

```markdown
## User report

{user_description}

## Context

| Field | Value |
|---|---|
| URL | {url} |
| Viewport | {width}x{height} |
| Device | {device_type} |
| Browser | {browser} {version} |
| OS | {os} |
| Timestamp | {iso_timestamp} |
| Project | {project_name} |

## Screenshot

{screenshot_image_or_none}

<!-- bugpilot:structured
{json_blob_of_all_context}
bugpilot:end -->
```

The JSON blob inside the HTML comment is what the Claude Action parses. Human-readable table is for GitHub display.

---

### 3. Claude GitHub Action

Triggered on `issues.opened` where the issue has a configured label (e.g. `user-feedback`).

**Steps:**

1. Parse the `<!-- bugpilot:structured ... -->` block from the issue body
2. Call Claude API with a triage prompt:
   - Is this a genuine bug, a feature request, noise/spam, or not actionable?
   - If a bug: is it reproducible given the context? What is the likely cause?
   - Draft a proposed fix or response (1-3 sentences)
   - Assign a severity: critical / high / low / won't-fix
3. Post a comment on the issue with the triage output
4. Apply labels: `triage: bug` / `triage: feature` / `triage: spam` / `triage: not-reproducible`
5. Send NTFY notification (see Component 4)

**Action inputs (in `action.yml`):**

```yaml
inputs:
  anthropic_api_key:
    required: true
  ntfy_url:
    required: true
  ntfy_topic:
    required: true
  triage_label:
    description: "Label that triggers triage"
    default: "user-feedback"
```

**Prompt design notes:**
- Include the structured JSON blob so Claude has all context
- Ask Claude to output structured JSON (classification, severity, proposed_fix, response_draft) — parse this in the Action, not free text
- Keep the prompt short; the issue body provides context

---

### 4. NTFY notification

Sent by the GitHub Action after triage is complete.

**Payload:**
- Title: `[{severity}] {issue_title}`
- Body: `{classification} — {proposed_fix_summary}`
- Actions:
  - `Apply fix` → triggers a webhook (GitHub Actions `workflow_dispatch`) that creates a PR with the proposed fix applied
  - `View issue` → deep link to the GitHub issue
  - `Dismiss` → closes the issue via GitHub API
  - `Defer` → adds a `deferred` label

**Apply fix flow:**
The "Apply fix" webhook triggers a second GitHub Action (`apply-fix.yml`) that:
1. Creates a branch
2. Asks Claude to implement the proposed fix as a code change
3. Opens a PR
4. Sends a follow-up NTFY notification with a link to the PR

This is the loop that closes the feedback cycle without touching a laptop.

---

## Milestones

### M1 — Widget + structured issue creation
- [ ] Widget JS: trigger button, form, context capture, screenshot, POST
- [ ] Flask route (content-engine): receive POST, create GitHub issue with structured body
- [ ] Theming via CSS custom properties, tested in content-engine dashboard
- [ ] npm package scaffold (not yet published)

### M2 — Claude triage Action
- [ ] `action.yml` + triage workflow
- [ ] Structured JSON output from Claude (classification, severity, proposed_fix)
- [ ] Label application
- [ ] NTFY notification with action buttons

### M3 — Apply-fix loop
- [ ] `apply-fix.yml` workflow triggered by NTFY action webhook
- [ ] Claude implements the fix as a code change on a branch
- [ ] PR opened, follow-up NTFY sent

### M4 — Portability
- [ ] Extract backend relay to Cloudflare Worker (or standalone express handler)
- [ ] CDN build of widget JS (unpkg / own CDN)
- [ ] Integration guide for non-Flask apps
- [ ] Integration guide for Hugo sites (inject via `<script>` in base template)

### M5 — Polish for external use (future)
- [ ] Hosted backend option (no self-hosting required)
- [ ] npm publish
- [ ] Landing page / docs site
- [ ] Pricing model

---

## Reference: BR360 implementation

The existing BR360 feedback capture covers M1 partially (form + context capture, no screenshot). Key files to extract from:

- `[br360 feedback form component]` — structured form fields
- `[br360 issue body formatter]` — structured markdown format (adapt to bugpilot schema above)

Extract these before building from scratch. The Claude Action and NTFY loop are net-new.

---

## Open decisions

1. **Backend for MVP:** Flask route in content-engine (fastest) vs standalone Cloudflare Worker (cleanest separation). Recommend Flask first, extract later.
2. **Screenshot approach:** `html2canvas` is the standard but has edge cases with cross-origin images. Accept the limitation for MVP.
3. **Webhook target for "Apply fix":** GitHub Actions `workflow_dispatch` is the natural trigger. Needs a PAT with `workflow` scope or GitHub App.
4. **Action distribution:** publish to GitHub Marketplace eventually. For now, reference via `uses: rodlunt/bugpilot/.github/actions/triage@main`.
