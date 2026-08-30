/** Base URL for browser requests to the Host, honoring reverse-proxy sub-path mounts. */

/**
 * Sentinel base for environments without a page: URLs joined against it stay
 * structurally valid while being unreachable, matching fixture transports.
 */
const INTERNAL_BASE = 'http://dsh.internal'

/**
 * Resolve the base URL browser requests must join.
 *
 * The strongest base is `document.baseURI`, which carries the `<base href>`
 * the Host injects into index.html and keeps requests behind reverse-proxy
 * sub-path mounts such as `/deepseek-harness/`. Workers and offline harnesses
 * have no document, so resolution falls back to the page origin, then to the
 * sentinel. Callers pass a path without a leading slash: `new URL('/api/x',
 * base)` discards the base pathname and escapes a sub-path mount.
 * @returns base accepted as the second argument of `new URL(path, base)`.
 */
export function resolveHostBase(): string {
  const doc = (globalThis as { document?: { baseURI?: string } }).document
  if (doc?.baseURI !== undefined && doc.baseURI !== '') return doc.baseURI
  const location = (globalThis as { location?: { origin?: string } }).location
  return location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
}
