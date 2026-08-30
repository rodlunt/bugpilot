// Trigger icons and the sanitiser for host-supplied `icon` markup.
//
// Both defaults draw with currentColor only, so the host accent
// (--bp-on-primary via the trigger's `color`) applies without the host
// having to know anything about the markup.

// Pill default: speech bubble (unchanged from earlier releases).
export const DEFAULT_PILL_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
  '</svg>'

// Tab default: a hand-drawn placeholder ladybird. Deliberately plain so the
// feature works before the owner picks one of the generated candidates in
// test/icon-candidates/.
export const DEFAULT_TAB_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="13.5" r="7.5"/>' +
  '<path d="M12 6v15"/>' +
  '<path d="M8.5 6.5a4 4 0 0 1 7 0"/>' +
  '<path d="M9.5 4l-1.5-2M14.5 4l1.5-2"/>' +
  '<circle cx="8.5" cy="11" r="1.1" fill="currentColor" stroke="none"/>' +
  '<circle cx="15.5" cy="11" r="1.1" fill="currentColor" stroke="none"/>' +
  '<circle cx="8.8" cy="16" r="1.1" fill="currentColor" stroke="none"/>' +
  '<circle cx="15.2" cy="16" r="1.1" fill="currentColor" stroke="none"/>' +
  '</svg>'

// Reject anything that is not a plain <svg> element or that carries an
// executable surface. This is an allow-by-shape check, not a full parser:
// the host is trusted enough to run scripts on its own page already, so the
// aim is to stop an accidental paste of scripted markup, not a hostile host.
const BLOCKED = [
  /<script/i,
  /<foreignobject/i,
  /<iframe/i,
  /\son[a-z]+\s*=/i,      // onload=, onclick=, etc.
  /javascript:/i,
  /<use\b[^>]*\shref\s*=\s*["']?\s*(https?:|\/\/)/i, // remote <use>
]

export function sanitiseIcon(markup) {
  if (typeof markup !== 'string') return null
  const trimmed = markup.trim()
  if (!/^<svg[\s>]/i.test(trimmed)) return null
  if (!/<\/svg>\s*$/i.test(trimmed)) return null
  for (const re of BLOCKED) {
    if (re.test(trimmed)) return null
  }
  return trimmed
}

export function resolveIcon(markup, variant) {
  const fallback = variant === 'tab' ? DEFAULT_TAB_ICON : DEFAULT_PILL_ICON
  if (markup === undefined || markup === null || markup === '') return fallback
  const clean = sanitiseIcon(markup)
  if (!clean) {
    console.warn('[bugpilot] icon rejected: must be inline <svg> markup with no script, on* handlers or javascript: URLs; using the default glyph')
    return fallback
  }
  return clean
}
