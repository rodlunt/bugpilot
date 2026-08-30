import { describe, it, expect } from 'vitest'
import path from 'path'
import { safePath, ntfyServerAndTopic, houseStyle } from './lib.mjs'

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
