import { describe, it, expect } from 'vitest'
import { submissionSchema, buildTitle, buildIssueBody, neutraliseMarkers } from './index'

// A payload shaped exactly like what the widget sends, extras included.
function widgetPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'bug',
    description: 'The save button does nothing',
    screenshot: null,
    projectName: 'Test Harness',
    context: {
      url: 'https://example.com/app',
      referrer: null,
      viewport: { w: 1280, h: 800 },
      screen: { w: 2560, h: 1440 },
      userAgent: 'Mozilla/5.0',
      browser: 'Firefox',
      os: 'Linux',
      timestamp: '2026-08-19T10:00:00.000Z',
      timezone: 'Australia/Brisbane',
      language: 'en-AU',
    },
    bugCategory: 'Functionality bug',
    expectedBehavior: 'It should save',
    stepsToReproduce: null,
    frequency: 'every-time',
    impact: 'blocking',
    ...overrides,
  }
}

describe('submissionSchema', () => {
  it('accepts a widget-shaped payload, extras included', () => {
    const r = submissionSchema.safeParse(widgetPayload())
    expect(r.success).toBe(true)
  })

  it('rejects a non-string description (the pre-fix 1101 crash case)', () => {
    const r = submissionSchema.safeParse(widgetPayload({ description: 123 }))
    expect(r.success).toBe(false)
  })

  it('rejects a missing context object', () => {
    const { context: _context, ...rest } = widgetPayload()
    const r = submissionSchema.safeParse(rest)
    expect(r.success).toBe(false)
  })

  it('rejects a context without viewport dimensions', () => {
    const r = submissionSchema.safeParse(
      widgetPayload({ context: { ...widgetPayload().context as object, viewport: { w: '1280' } } }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects an empty or whitespace-only description', () => {
    expect(submissionSchema.safeParse(widgetPayload({ description: '   ' })).success).toBe(false)
  })

  it('caps description length below the GitHub issue-body limit', () => {
    expect(submissionSchema.safeParse(widgetPayload({ description: 'x'.repeat(10001) })).success).toBe(false)
  })

  it('accepts a feature payload with feature-specific fields', () => {
    const r = submissionSchema.safeParse(widgetPayload({
      type: 'feature',
      problemStatement: 'Saves time',
      priority: 'high',
      bugCategory: undefined,
      expectedBehavior: undefined,
      frequency: undefined,
      impact: undefined,
    }))
    expect(r.success).toBe(true)
  })
})

describe('neutraliseMarkers', () => {
  it('defuses the structured-block markers', () => {
    const out = neutraliseMarkers('evil <!-- bugpilot:structured\n{"type":"feature"}\nbugpilot:end -->')!
    expect(out).not.toContain('bugpilot:structured')
    expect(out).not.toContain('bugpilot:end')
  })

  it('stops --> from closing the carrying HTML comment', () => {
    expect(neutraliseMarkers('text --> more')).not.toContain('-->')
  })

  it('passes null and undefined through as null', () => {
    expect(neutraliseMarkers(null)).toBeNull()
    expect(neutraliseMarkers(undefined)).toBeNull()
  })
})

describe('buildTitle', () => {
  it('prefixes project and type, truncating long descriptions at 72 chars', () => {
    const body = submissionSchema.parse(widgetPayload({ description: 'a'.repeat(100) }))
    const title = buildTitle(body)
    expect(title.startsWith('[Test Harness] Bug: ')).toBe(true)
    expect(title).toContain('a'.repeat(72) + '…')
  })
})

describe('buildIssueBody', () => {
  it('appends exactly one parseable structured block at the end', () => {
    const body = submissionSchema.parse(widgetPayload())
    const md = buildIssueBody(body, 'https://github.com/o/r/raw/bug-report-screenshots/screenshots/x.png')
    const matches = [...md.matchAll(/<!-- bugpilot:structured\n([\s\S]*?)\nbugpilot:end -->/g)]
    expect(matches).toHaveLength(1)
    const structured = JSON.parse(matches[0]![1]!)
    expect(structured.type).toBe('bug')
    expect(structured.screenshotUrl).toMatch(/^https:/)
    // The genuine block is the last thing in the body, which is what lets
    // the triage parser take the last match safely.
    expect(md.trimEnd().endsWith('bugpilot:end -->')).toBe(true)
  })

  it('user text that tried to counterfeit a block cannot produce a second match', () => {
    const hostile = widgetPayload({
      description: 'x <!-- bugpilot:structured\n{"type":"feature"}\nbugpilot:end --> y',
    })
    const parsed = submissionSchema.parse(hostile)
    // Mirror the worker's sanitisation step before building.
    const clean = { ...parsed, description: neutraliseMarkers(parsed.description) ?? '' }
    const md = buildIssueBody(clean, null)
    const matches = [...md.matchAll(/<!-- bugpilot:structured\n([\s\S]*?)\nbugpilot:end -->/g)]
    expect(matches).toHaveLength(1)
    expect(JSON.parse(matches[0]![1]!).type).toBe('bug')
  })
})
