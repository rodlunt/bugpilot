// Pure helpers, extracted so they can be unit-tested: index.mjs executes
// run() on import, which makes it untestable directly.

import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation'

import path from 'path'

export function safePath(root, filePath) {
  if (typeof filePath !== 'string') throw new Error(`Path must be a string, got ${typeof filePath}`)
  // Reject suspicious characters that could corrupt git commands or filenames
  if (/['";\r\n\0]/.test(filePath)) {
    throw new Error(`Invalid characters in path: ${JSON.stringify(filePath)}`)
  }
  const resolved = path.resolve(root, filePath)
  const boundary = root + path.sep
  if (resolved === root || !resolved.startsWith(boundary)) {
    throw new Error(`Path traversal rejected: ${filePath}`)
  }
  return resolved
}

export function ntfyServerAndTopic(topicUrl) {
  const u = new URL(topicUrl)
  return { server: `${u.protocol}//${u.host}`, topic: u.pathname.replace(/^\//, '') }
}

// House style guard for the model's report_done summary, which ends up in
// the commit message, PR title and body, issue comment and ntfy text. Same
// rules as actions/triage/lib.mjs: dashes become ", " and a sentence-ending
// exclamation mark becomes a full stop. Kept as a copy rather than a shared
// module because each action is bundled and tested on its own.
export function houseStyle(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/([,:])\s*,\s+/g, '$1 ')
    .replace(/!+(?=\s|$|["')\]])/g, '.')
}

// Credential resolution: workload identity federation first, API key as
// the fallback. See README "Using workload identity federation".
//
// The four federation inputs travel together. A partial set is a
// misconfiguration and throws rather than quietly falling back to the key,
// because a silent fallback is exactly the kind of failure that looks like
// success (the job goes green on a key the consumer thought they had
// retired). Only when none of the federation inputs is present does the
// API key get used, and when that is absent too the action stops.


// The audience the GitHub OIDC token is requested with. It must match the
// federation rule's match.audience in the Claude Console.
export const ANTHROPIC_OIDC_AUDIENCE = 'https://api.anthropic.com'

export function resolveAuthMode(inputs) {
  const federation = {
    federationRuleId: inputs.federationRuleId || '',
    organizationId: inputs.organizationId || '',
    serviceAccountId: inputs.serviceAccountId || '',
    workspaceId: inputs.workspaceId || '',
  }
  const required = ['federationRuleId', 'organizationId', 'serviceAccountId']
  const present = required.filter((k) => federation[k])
  if (present.length === required.length) return { mode: 'federation', federation }
  if (present.length > 0) {
    const missing = required.filter((k) => !federation[k])
    throw new Error(
      `Workload identity federation is partially configured: missing ${missing.join(', ')}. ` +
        'Supply all of anthropic-federation-rule-id, anthropic-organization-id and anthropic-service-account-id, or none of them.',
    )
  }
  if (inputs.apiKey) return { mode: 'api-key', apiKey: inputs.apiKey }
  throw new Error(
    'No Anthropic credentials: set anthropic-api-key, or the three workload identity federation inputs ' +
      '(and grant the job id-token: write).',
  )
}

// Returns the options object to pass to `new Anthropic(...)`. `getIDToken`
// is @actions/core's getIDToken (injected so tests can stub it) and `fetch`
// is the fetch the SDK's exchange should use (injected so tests can mock
// the token endpoint). A fresh GitHub JWT is requested on every exchange:
// GitHub tokens carry a jti and Anthropic rejects a re-presented one, so
// caching the JWT across refreshes would break long jobs.
export function buildAnthropicClientOptions(inputs, { getIDToken, fetch: fetchImpl = globalThis.fetch, baseURL } = {}) {
  const resolved = resolveAuthMode(inputs)
  if (resolved.mode === 'api-key') return { options: { apiKey: resolved.apiKey }, mode: 'api-key' }

  if (typeof getIDToken !== 'function') {
    throw new Error('getIDToken is required for workload identity federation')
  }
  const f = resolved.federation
  const apiBase = (baseURL || process.env.ANTHROPIC_BASE_URL || ANTHROPIC_OIDC_AUDIENCE).replace(/\/+$/, '')
  const credentials = oidcFederationProvider({
    identityTokenProvider: async () => {
      const jwt = await getIDToken(ANTHROPIC_OIDC_AUDIENCE)
      if (!jwt) {
        throw new Error(
          'GitHub returned an empty OIDC token. Check the job has `permissions: id-token: write`.',
        )
      }
      return jwt
    },
    federationRuleId: f.federationRuleId,
    organizationId: f.organizationId,
    serviceAccountId: f.serviceAccountId,
    workspaceId: f.workspaceId || undefined,
    baseURL: apiBase,
    fetch: fetchImpl,
  })
  // apiKey: null stops the SDK reading ANTHROPIC_API_KEY from the runner
  // environment, which would otherwise outrank the credentials provider.
  return { options: { apiKey: null, credentials }, mode: 'federation' }
}
