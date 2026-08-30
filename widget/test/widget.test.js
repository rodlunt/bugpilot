import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BugPilot from '../src/index.js'
import { sanitiseIcon, resolveIcon, DEFAULT_TAB_ICON, DEFAULT_PILL_ICON } from '../src/icon.js'
import { DragTracker, HIT, DRAG_THRESHOLD, readDock, writeDock, storageKey, clampY } from '../src/dock.js'
const ENDPOINT = 'https://example.test/feedback'

function init(extra = {}) {
  return BugPilot.init({ endpoint: ENDPOINT, projectName: 'Test', ...extra })
}

// jsdom has PointerEvent but no pointer capture; the widget guards
// setPointerCapture with ?. so plain PointerEvents are enough here.
function pointer(el, type, { x, y, id = 1, button = 0 }) {
  el.dispatchEvent(new window.PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button,
  }))
}

function setViewport(w, h) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true })
}

beforeEach(() => {
  setViewport(1000, 800)
  localStorage.clear()
})

afterEach(() => {
  BugPilot.destroy()
  document.querySelectorAll('.bp-trigger, .bp-dialog, .bp-backdrop').forEach((el) => el.remove())
  vi.restoreAllMocks()
})

describe('variant rendering', () => {
  it('defaults to the pill with label and bubble icon', () => {
    init()
    const t = document.querySelector('.bp-trigger')
    expect(t.classList.contains('bp-trigger--pill')).toBe(true)
    expect(t.classList.contains('bp-trigger--bottom-right')).toBe(true)
    expect(t.textContent).toContain('Feedback')
    expect(t.querySelector('svg path')).not.toBeNull()
    expect(t.getAttribute('aria-label')).toBe('Open feedback form')
  })

  it('renders the tab variant docked right by default with no label', () => {
    init({ variant: 'tab' })
    const t = document.querySelector('.bp-trigger')
    expect(t.classList.contains('bp-trigger--tab')).toBe(true)
    expect(t.classList.contains('bp-trigger--right')).toBe(true)
    expect(t.getAttribute('data-bp-side')).toBe('right')
    expect(t.textContent.trim()).toBe('')
    expect(t.getAttribute('aria-label')).toBe('Open feedback form')
    expect(t.querySelector('.bp-tab-face svg')).not.toBeNull()
    // Centred vertically on first visit
    expect(t.style.top).toBe(`${Math.round((800 - HIT) / 2)}px`)
    expect(document.querySelector('.bp-dialog').classList.contains('bp-dialog--right')).toBe(true)
  })

  it('honours side: left and falls back on rubbish values', () => {
    init({ variant: 'tab', side: 'left' })
    expect(document.querySelector('.bp-trigger').getAttribute('data-bp-side')).toBe('left')
    BugPilot.destroy()
    init({ variant: 'sideways', side: 'up' })
    const t = document.querySelector('.bp-trigger')
    expect(t.classList.contains('bp-trigger--pill')).toBe(true)
  })

  it('the tab default glyph and the pill default glyph both use currentColor only', () => {
    for (const svg of [DEFAULT_TAB_ICON, DEFAULT_PILL_ICON]) {
      expect(svg).toMatch(/currentColor/)
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}/i)
    }
  })
})

describe('tap vs drag', () => {
  it('a tap (movement under the threshold) opens the dialog', () => {
    init({ variant: 'tab' })
    const t = document.querySelector('.bp-trigger')
    pointer(t, 'pointerdown', { x: 980, y: 400 })
    pointer(t, 'pointermove', { x: 983, y: 402 })
    pointer(t, 'pointerup', { x: 983, y: 402 })
    t.click()
    expect(document.querySelector('.bp-dialog').classList.contains('bp-visible')).toBe(true)
  })

  it('a drag past the threshold moves the tab and does not open the dialog', () => {
    init({ variant: 'tab' })
    const t = document.querySelector('.bp-trigger')
    const startTop = parseInt(t.style.top, 10)
    pointer(t, 'pointerdown', { x: 980, y: 400 })
    pointer(t, 'pointermove', { x: 980, y: 400 + DRAG_THRESHOLD + 30 })
    expect(t.classList.contains('bp-trigger--dragging')).toBe(true)
    pointer(t, 'pointerup', { x: 980, y: 400 + DRAG_THRESHOLD + 30 })
    t.click()
    expect(document.querySelector('.bp-dialog').classList.contains('bp-visible')).toBe(false)
    expect(parseInt(t.style.top, 10)).toBe(startTop + DRAG_THRESHOLD + 30)
    expect(t.getAttribute('data-bp-side')).toBe('right')
    // The click suppression is one-shot: the next tap opens as normal.
    t.click()
    expect(document.querySelector('.bp-dialog').classList.contains('bp-visible')).toBe(true)
  })

  it('clamps the vertical position inside the viewport', () => {
    init({ variant: 'tab' })
    const t = document.querySelector('.bp-trigger')
    pointer(t, 'pointerdown', { x: 980, y: 400 })
    pointer(t, 'pointermove', { x: 980, y: 5000 })
    pointer(t, 'pointerup', { x: 980, y: 5000 })
    expect(parseInt(t.style.top, 10)).toBe(800 - HIT)
  })
})

describe('side swap on release', () => {
  it('swaps to the left when released past the viewport midline', () => {
    init({ variant: 'tab' })
    const t = document.querySelector('.bp-trigger')
    pointer(t, 'pointerdown', { x: 980, y: 400 })
    pointer(t, 'pointermove', { x: 300, y: 410 })
    pointer(t, 'pointerup', { x: 300, y: 410 })
    expect(t.getAttribute('data-bp-side')).toBe('left')
    expect(t.classList.contains('bp-trigger--left')).toBe(true)
    expect(t.classList.contains('bp-trigger--right')).toBe(false)
    expect(document.querySelector('.bp-dialog').classList.contains('bp-dialog--left')).toBe(true)
  })

  it('stays put when released on its own half', () => {
    init({ variant: 'tab' })
    const t = document.querySelector('.bp-trigger')
    pointer(t, 'pointerdown', { x: 980, y: 400 })
    pointer(t, 'pointermove', { x: 600, y: 450 })
    pointer(t, 'pointerup', { x: 600, y: 450 })
    expect(t.getAttribute('data-bp-side')).toBe('right')
  })

  it('pure tracker: left to right crossing', () => {
    const d = new DragTracker({ side: 'left', y: 100, viewportWidth: 1000, viewportHeight: 800 })
    d.start(20, 100)
    expect(d.move(22, 101)).toBeNull()
    expect(d.move(700, 120)).toEqual({ y: 120, dx: 680 })
    expect(d.end()).toEqual({ wasDrag: true, side: 'right', y: 120, swapped: true })
  })
})

describe('localStorage persistence', () => {
  it('writes { side, y } keyed per origin after a drag', () => {
    init({ variant: 'tab' })
    const t = document.querySelector('.bp-trigger')
    pointer(t, 'pointerdown', { x: 980, y: 400 })
    pointer(t, 'pointermove', { x: 300, y: 500 })
    pointer(t, 'pointerup', { x: 300, y: 500 })
    const raw = localStorage.getItem(storageKey(window.location.origin))
    expect(JSON.parse(raw)).toEqual({ side: 'left', y: parseInt(t.style.top, 10) })
  })

  it('restores a stored position over the configured side', () => {
    localStorage.setItem(storageKey(window.location.origin), JSON.stringify({ side: 'left', y: 123 }))
    init({ variant: 'tab', side: 'right' })
    const t = document.querySelector('.bp-trigger')
    expect(t.getAttribute('data-bp-side')).toBe('left')
    expect(t.style.top).toBe('123px')
  })

  it('clamps a stored y that no longer fits the viewport', () => {
    localStorage.setItem(storageKey(window.location.origin), JSON.stringify({ side: 'right', y: 5000 }))
    init({ variant: 'tab' })
    expect(document.querySelector('.bp-trigger').style.top).toBe(`${800 - HIT}px`)
  })

  it.each([
    ['not json', '{nope'],
    ['wrong side', '{"side":"top","y":10}'],
    ['non-numeric y', '{"side":"left","y":"10"}'],
    ['NaN y', '{"side":"left","y":null}'],
    ['array', '[1,2]'],
  ])('falls back to defaults on a corrupt value (%s)', (_label, value) => {
    localStorage.setItem(storageKey(window.location.origin), value)
    init({ variant: 'tab', side: 'right' })
    const t = document.querySelector('.bp-trigger')
    expect(t.getAttribute('data-bp-side')).toBe('right')
    expect(t.style.top).toBe(`${Math.round((800 - HIT) / 2)}px`)
  })

  it('renders with storage that throws on read and write', () => {
    const broken = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
    }
    expect(readDock(broken, 'https://a.test', 800)).toBeNull()
    expect(writeDock(broken, 'https://a.test', { side: 'left', y: 1 })).toBe(false)
    expect(readDock(null, 'https://a.test', 800)).toBeNull()
    expect(clampY(-50, 800)).toBe(0)
  })
})

describe('icon option and sanitiser', () => {
  it('accepts plain svg markup and uses it in both variants', () => {
    const icon = '<svg viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="4"/></svg>'
    init({ variant: 'tab', icon })
    expect(document.querySelector('.bp-tab-face circle')).not.toBeNull()
    BugPilot.destroy()
    init({ icon })
    expect(document.querySelector('.bp-trigger-icon circle')).not.toBeNull()
  })

  it.each([
    ['script tag', '<svg><script>alert(1)</script></svg>'],
    ['onload handler', '<svg onload="alert(1)"><path d="M0 0"/></svg>'],
    ['onclick on child', '<svg><path onclick="x()" d="M0 0"/></svg>'],
    ['javascript: url', '<svg><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>'],
    ['foreignObject', '<svg><foreignObject><div>x</div></foreignObject></svg>'],
    ['not svg', '<img src=x onerror="alert(1)">'],
    ['leading text', 'hello <svg></svg>'],
    ['number', 42],
  ])('rejects %s', (_label, markup) => {
    expect(sanitiseIcon(markup)).toBeNull()
  })

  it('falls back to the default glyph and warns when rejected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init({ variant: 'tab', icon: '<svg onload="alert(1)"></svg>' })
    const face = document.querySelector('.bp-tab-face')
    expect(face.querySelector('svg').hasAttribute('onload')).toBe(false)
    // Placeholder ladybird: four spots plus the body circle
    expect(face.querySelectorAll('circle').length).toBe(5)
    expect(warn).toHaveBeenCalledOnce()
    expect(resolveIcon('', 'pill')).toBe(DEFAULT_PILL_ICON)
  })
})
