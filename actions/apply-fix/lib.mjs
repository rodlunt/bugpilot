// Pure helpers, extracted so they can be unit-tested: index.mjs executes
// run() on import, which makes it untestable directly.

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
