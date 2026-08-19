import { describe, it, expect } from 'vitest'
import { parseStructuredBlock, buildComment, deriveLabels, ntfyServerAndTopic, buildUserMessage } from './lib.mjs'

const block = (json) => `<!-- bugpilot:structured\n${json}\nbugpilot:end -->`

describe('parseStructuredBlock', () => {
  it('parses the structured block out of an issue body', () => {
    const body = `## What happened\n\nstuff\n\n${block('{"type":"bug","projectName":"X"}')}\n`
    expect(parseStructuredBlock(body)).toEqual({ type: 'bug', projectName: 'X' })
  })

  it('takes the LAST block when user text smuggled an earlier one in', () => {
    const body = `${block('{"type":"feature"}')}\n\nreal report\n\n${block('{"type":"bug"}')}\n`
    expect(parseStructuredBlock(body)).toEqual({ type: 'bug' })
  })

  it('returns null for a missing block, an empty body, and invalid JSON', () => {
    expect(parseStructuredBlock('no block here')).toBeNull()
    expect(parseStructuredBlock('')).toBeNull()
    expect(parseStructuredBlock(null)).toBeNull()
    expect(parseStructuredBlock(block('{nope'))).toBeNull()
  })
})

describe('deriveLabels', () => {
  it('maps classification and severity to labels', () => {
    expect(deriveLabels({ classification: 'bug', severity: 'high' }))
      .toEqual(['triage:confirmed-bug', 'severity:high'])
  })

  it('returns nothing for an unknown classification with no severity', () => {
    expect(deriveLabels({ classification: 'mystery' })).toEqual([])
  })
})

describe('buildComment', () => {
  it('renders classification, severity, fix and quoted draft', () => {
    const c = buildComment({
      classification: 'bug',
      severity: 'medium',
      reproducible: true,
      proposed_fix: 'Guard the null',
      response_draft: 'Thanks!\nWe are on it.',
    })
    expect(c).toContain('### bugpilot triage')
    expect(c).toContain('**Classification:** Bug')
    expect(c).toContain('**Severity:** medium')
    expect(c).toContain('**Proposed fix:** Guard the null')
    expect(c).toContain('> Thanks!\n> We are on it.')
  })
})

describe('ntfyServerAndTopic', () => {
  it('accepts a bare slug, a host/path, and a full URL', () => {
    expect(ntfyServerAndTopic('my-topic')).toEqual({ server: 'https://ntfy.sh', topic: 'my-topic' })
    expect(ntfyServerAndTopic('ntfy.example.com/bugs')).toEqual({ server: 'https://ntfy.example.com', topic: 'bugs' })
    expect(ntfyServerAndTopic('https://ntfy.sh/other')).toEqual({ server: 'https://ntfy.sh', topic: 'other' })
  })
})

describe('buildUserMessage', () => {
  it('includes issue number, title, body and the structured JSON when present', () => {
    const msg = buildUserMessage({ number: 7, title: 'T', body: 'B' }, { type: 'bug' })
    expect(msg).toContain('Issue #7: T')
    expect(msg).toContain('"type": "bug"')
  })
})
