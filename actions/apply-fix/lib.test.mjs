import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { safePath, ntfyServerAndTopic, houseStyle, resolveAuthMode, buildAnthropicClientOptions, ANTHROPIC_OIDC_AUDIENCE } from './lib.mjs'

const ROOT = path.resolve('/repo')

describe('safePath', () => {
  it('resolves a normal relative path inside the root', () => {
    expect(safePath(ROOT, 'src/widget.js')).toBe(path.join(ROOT, 'src', 'widget.js'))
  })

  it('rejects traversal out of the repo root', () => {
    expect(() => safePath(ROOT, '../etc/passwd')).toThrow(/traversal/)
    expect(() => safePath(ROOT, '..')).toThrow(/traversal/)
  })

  it('rejects the root itself', () => {
    expect(() => safePath(ROOT, '.')).toThrow(/traversal/)
  })

  it('rejects an absolute path outside the root', () => {
    expect(() => safePath(ROOT, '/etc/passwd')).toThrow(/traversal/)
  })

  it('rejects shell-hostile characters', () => {
    expect(() => safePath(ROOT, "a';rm -rf .;'")).toThrow(/Invalid characters/)
    expect(() => safePath(ROOT, 'a\nb')).toThrow(/Invalid characters/)
  })

  it('rejects non-string input', () => {
    expect(() => safePath(ROOT, 42)).toThrow(/must be a string/)
  })

  it('does not treat a sibling directory with the root as prefix as inside', () => {
    // /repo-evil starts with the string /repo but is outside the boundary
    expect(() => safePath(ROOT, '../repo-evil/file')).toThrow(/traversal/)
  })
})

describe('ntfyServerAndTopic', () => {
  it('splits a full topic URL', () => {
    expect(ntfyServerAndTopic('https://ntfy.example.com/fixes'))
      .toEqual({ server: 'https://ntfy.example.com', topic: 'fixes' })
  })

  it('throws on a bare slug (apply-fix requires a full URL)', () => {
    expect(() => ntfyServerAndTopic('just-a-slug')).toThrow()
  })
})

describe('houseStyle', () => {
  it('replaces em and en dashes with a comma and turns exclamation marks into full stops', () => {
    expect(houseStyle('Guarded the null — added a test!')).toBe('Guarded the null, added a test.')
    expect(houseStyle('2024–2025 range')).toBe('2024, 2025 range')
  })

  it('leaves compliant text alone', () => {
    const clean = 'Guarded the null in safePath and added a test (issue #12).'
    expect(houseStyle(clean)).toBe(clean)
  })

  it('control: a summary with a dash and an exclamation mark is changed, not passed through', () => {
    const offending = 'Done — fixed it!'
    expect(houseStyle(offending)).not.toBe(offending)
    expect(houseStyle(offending)).not.toMatch(/[—–!]/)
  })
})

const FED = {
  federationRuleId: 'fdrl_test',
  organizationId: '00000000-0000-0000-0000-000000000000',
  serviceAccountId: 'svac_test',
}

describe('resolveAuthMode', () => {
  it('prefers federation when all three federation inputs are present', () => {
    expect(resolveAuthMode({ ...FED, apiKey: 'sk-ant-x' }).mode).toBe('federation')
  })

  it('falls back to the API key when no federation input is set', () => {
    expect(resolveAuthMode({ apiKey: 'sk-ant-x', federationRuleId: '', organizationId: '' }))
      .toEqual({ mode: 'api-key', apiKey: 'sk-ant-x' })
  })

  it('fails closed on a partial federation config instead of falling back to the key', () => {
    expect(() => resolveAuthMode({ apiKey: 'sk-ant-x', federationRuleId: 'fdrl_test' }))
      .toThrow(/partially configured: missing organizationId, serviceAccountId/)
  })

  it('throws when neither credential is available', () => {
    expect(() => resolveAuthMode({})).toThrow(/No Anthropic credentials/)
  })
})

describe('buildAnthropicClientOptions', () => {
  it('returns a plain apiKey option in api-key mode', () => {
    const { options, mode } = buildAnthropicClientOptions({ apiKey: 'sk-ant-x' })
    expect(mode).toBe('api-key')
    expect(options).toEqual({ apiKey: 'sk-ant-x' })
  })

  it('exchanges a fresh GitHub OIDC token for an Anthropic access token via the jwt-bearer grant', async () => {
    const calls = []
    let n = 0
    const getIDToken = vi.fn(async (aud) => `jwt-${++n}-for-${aud}`)
    const fetch = vi.fn(async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ access_token: 'sk-ant-oat01-short', expires_in: 600, token_type: 'Bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const { options, mode } = buildAnthropicClientOptions({ ...FED, workspaceId: 'wrkspc_1' }, { getIDToken, fetch })
    expect(mode).toBe('federation')
    // apiKey: null keeps a stray ANTHROPIC_API_KEY on the runner from outranking federation.
    expect(options.apiKey).toBeNull()

    const first = await options.credentials()
    expect(first.token).toBe('sk-ant-oat01-short')
    expect(first.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 500)

    expect(getIDToken).toHaveBeenCalledWith(ANTHROPIC_OIDC_AUDIENCE)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/oauth/token')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: 'jwt-1-for-https://api.anthropic.com',
      federation_rule_id: 'fdrl_test',
      organization_id: '00000000-0000-0000-0000-000000000000',
      service_account_id: 'svac_test',
      workspace_id: 'wrkspc_1',
    })

    // A second exchange must present a NEW GitHub JWT (jti is single-use server-side).
    await options.credentials()
    expect(JSON.parse(calls[1].init.body).assertion).toBe('jwt-2-for-https://api.anthropic.com')
  })

  it('surfaces a denied exchange as an error rather than a token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Authentication failed' } }), { status: 401 }))
    const { options } = buildAnthropicClientOptions(FED, { getIDToken: async () => 'jwt', fetch })
    await expect(options.credentials()).rejects.toThrow(/status 401/)
  })

  it('fails when GitHub hands back an empty OIDC token (id-token: write missing)', async () => {
    const fetch = vi.fn()
    const { options } = buildAnthropicClientOptions(FED, { getIDToken: async () => '', fetch })
    await expect(options.credentials()).rejects.toThrow(/id-token: write/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('control: the mocked endpoint is actually consulted, so an unreachable exchange is not reported as success', async () => {
    const fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const { options } = buildAnthropicClientOptions(FED, { getIDToken: async () => 'jwt', fetch })
    await expect(options.credentials()).rejects.toThrow(/Failed to reach token endpoint/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
