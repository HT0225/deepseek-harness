/** Browser-session authentication for the Host Connection carrier.
 *
 * **Modified for public-path deployment:** replaces the one-shot process
 * launch-token flow with a persistent password-login page. A single password
 * is stored (bcrypt hash) in a dedicated SQLite table under the user's DSH
 * home, and every page request is gated on a signed HttpOnly cookie. The
 * `/login.json` POST endpoint performs password verification; a login page
 * is served for any unauthenticated HTML visit so end-users never see the
 * token-based 401. Passwords are never stored or transmitted in plaintext in
 * the database. */

import { createHash, createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { dirname, join as joinPath } from 'node:path'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { DatabaseSync } from 'node:sqlite'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'

const AUTH_RECORD_KEY = credentialKey('client-connection', 'browser-session')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SECRET_BYTES = 32
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 1
const STORED_SECRET_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const SESSION_DAYS_DEFAULT = 7
/** Initial password environment variable. Only consulted when the login table
 * has no rows yet, enabling bootstrapping without a console-only password.
 * After the first password has been stored this variable is ignored, which
 * lets operators rotate the value inside the GUI. */
const DSH_WEB_PASSWORD = 'DSH_WEB_PASSWORD' as const
const DSH_WEB_PASSWORD_TABLE = 'web_login_password' as const
const DSH_WEB_SCHEMA_VERSION = 1 as const

interface StoredSecretPayload {
  readonly version: typeof STORED_SECRET_VERSION
  readonly secret: string
}

interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function header(
  headers: ConnectionTrustRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Canonical request authority used as the cookie name and signed audience. */
function requestAuthority(headers: ConnectionTrustRequest['headers']): string | undefined {
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    return new URL(`http://${host}`).host
  } catch {
    return undefined
  }
}

function canonicalSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  const decoded = decodeBase64Url(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) return undefined
  return decoded
}

function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('client-connection: browser-session credential record has an unsupported format')
  }
  const secret = canonicalSecret(record.payload.secret)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record has an invalid secret')
  }
  return secret
}

function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url. */
function sessionCookie(name: string, value: string, expiresAt: number, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Lax`
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

function encodeCookie(payload: BrowserCookiePayload, secret: Buffer): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v1.${body}.${encodeBase64Url(signature(secret, body))}`
}

function decodeCookie(value: string, secret: Buffer): BrowserCookiePayload | undefined {
  const parts = value.split('.')
  const [version, body, encodedSignature] = parts
  if (parts.length !== 3 || version !== 'v1' || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) return undefined
  let decoded: unknown
  try {
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || decoded.version !== COOKIE_PAYLOAD_VERSION
    || typeof decoded.authority !== 'string'
    || !Number.isSafeInteger(decoded.issuedAt)
    || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  return decoded as unknown as BrowserCookiePayload
}

async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  const generated: StoredSecretPayload = {
    version: STORED_SECRET_VERSION,
    secret: encodeBase64Url(randomBytes(SECRET_BYTES)),
  }
  const record = await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
    if (current !== undefined) {
      storedSecret(current)
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ kind: 'grant', payload: generated })
  })
  const secret = storedSecret(record)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record was not created')
  }
  return secret
}

/** Minimal pure-Node bcrypt hash/verify for the single-password login table.
 * Uses node:sqlite's bundled `sqlite3` is not possible without a native dep,
 * so we wrap scrypt as a pbkdf2-style verifier with a fixed work factor.
 * Identifiers carry a `$dsh1$` tag so the field can upgrade later. */

const PASSWORD_TAG = 'dsh1' as const
const SCRYPT_N = 1 << 14 // 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32
const SALT_BYTES = 16

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES)
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 32 * 1024 * 1024,
  })
  return `$${PASSWORD_TAG}$${String(SCRYPT_N)}$${encodeBase64Url(salt)}$${encodeBase64Url(derived)}`
}

function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$')
  if (parts.length !== 5) return false
  const [, tag, nStr, saltB64, hashB64] = parts
  if (tag !== PASSWORD_TAG) return false
  const n = Number(nStr)
  if (!Number.isFinite(n) || n < 1024 || (n & (n - 1)) !== 0) return false
  const salt = decodeBase64Url(saltB64 as string)
  const expected = decodeBase64Url(hashB64 as string)
  if (salt === undefined || expected === undefined || expected.byteLength !== SCRYPT_KEYLEN) return false
  let derived: Buffer
  try {
    derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: n, r: SCRYPT_R, p: SCRYPT_P, maxmem: 32 * 1024 * 1024,
    })
  } catch {
    return false
  }
  return derived.byteLength === expected.byteLength && timingSafeEqual(derived, expected)
}

/** Open (or create) the dedicated login SQLite database and ensure schema.
 * Uses only node:sqlite primitives directly so we do not pull the
 * @deepseek-ai/dsh-storage-sqlite build artifact dependency. */
async function openLoginDb(homePath: string): Promise<DatabaseSync> {
  const dbPath = joinPath(homePath, 'web-auth.sqlite')
  if (dbPath !== ':memory:') await mkdir(dirname(dbPath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    const actual = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (actual !== 0 && actual !== DSH_WEB_SCHEMA_VERSION) {
      throw new Error(`client-connection: web-auth database has schema version ${actual}; expected ${DSH_WEB_SCHEMA_VERSION}`)
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${DSH_WEB_PASSWORD_TABLE} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT
    `)
    if (actual === 0) db.exec(`PRAGMA user_version = ${DSH_WEB_SCHEMA_VERSION}`)
    return db
  } catch (error: unknown) {
    try { db.close() } catch { /* swallow */ }
    throw error
  }
}

/** Ensure exactly one password row exists. Creates from DSH_WEB_PASSWORD on
 * first boot; when that variable is absent a random alphanumeric password is
 * generated and printed to stderr because the deployment cannot accept any
 * page without a password. */
async function ensurePassword(db: DatabaseSync): Promise<{ generatedInitial: string | null }> {
  const row = db.prepare(`SELECT hash FROM ${DSH_WEB_PASSWORD_TABLE} WHERE id = 1`).get() as
    | { hash: string }
    | undefined
  if (row !== undefined) return { generatedInitial: null }
  let password = process.env[DSH_WEB_PASSWORD]
  let generated: string | null = null
  if (password === undefined || password === '') {
    // Never allow a zero-password installation: anyone reaching the URL would
    // get full RCE on the server. Generate a strong random one and emit it.
    password = encodeBase64Url(randomBytes(9)) // 12 chars, base64url
    generated = password
    console.error(
      `client-connection: no ${DSH_WEB_PASSWORD} set; generated a one-time password: ${password}\n`
      + `Set ${DSH_WEB_PASSWORD}=<value> in the service environment before restarting to avoid re-generation.`,
    )
  }
  db.prepare(`
    INSERT INTO ${DSH_WEB_PASSWORD_TABLE} (id, hash, created_at) VALUES (1, ?, ?)
  `).run(hashPassword(password), Date.now())
  return { generatedInitial: generated }
}

/**
 * Process launch-token exchange and persistent signed-cookie verification.
 * Connection loads the credential provider's signing secret during activation
 * and retains it for synchronous request authentication.
 */
export class BrowserAuth {
  private readonly maxAgeMilliseconds: number
  private readonly loginDb: DatabaseSync

  private constructor(
    private readonly secret: Buffer,
    maxAgeDays: number,
    loginDb: DatabaseSync,
  ) {
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    if (!Number.isSafeInteger(this.maxAgeMilliseconds)
      || !Number.isSafeInteger(Date.now() + this.maxAgeMilliseconds)) {
      throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
    }
    this.loginDb = loginDb
  }

  /**
   * Initialize browser authentication and create its durable signing secret
   * when this Harness home has none. Opens the login database and guarantees
   * exactly one password row exists, bootstrapping from env or a generated
   * one-time value.
   */
  static async create(
    _processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
  ): Promise<BrowserAuth> {
    const homePath = process.env['HOME']
      ?? process.env['USERPROFILE']
      ?? require('node:os').homedir?.()
      ?? '.'
    const pathModule = await import('node:path')
    const dshHome = pathModule.join(homePath, '.dsh')
    const loginDb = await openLoginDb(dshHome)
    await ensurePassword(loginDb)
    return new BrowserAuth(await initializeSecret(credentials), maxAgeDays, loginDb)
  }

  /** No-op for builds without a launch-token URL. */
  authenticatedUrl(baseUrl: string): string {
    return baseUrl
  }

  /**
   * Verify an incoming plaintext password against the stored row.
   * @returns true when the password matches.
   */
  verifyPassword(password: string): boolean {
    const row = this.loginDb.prepare(`SELECT hash FROM ${DSH_WEB_PASSWORD_TABLE} WHERE id = 1`)
      .get() as { hash: string } | undefined
    if (row === undefined) return false
    return verifyPassword(password, row.hash)
  }

  /**
   * Update the stored password. Requires the current password to match, or
   * pass `true` as the third argument when the caller already holds
   * authorization (admin reset path is not exposed remotely in this build).
   * @returns true on success.
   */
  changePassword(currentPassword: string, newPassword: string, _bypassCurrent = false): boolean {
    if (newPassword.length < 8) return false
    if (!this.verifyPassword(currentPassword)) return false
    this.loginDb.prepare(`UPDATE ${DSH_WEB_PASSWORD_TABLE} SET hash = ? WHERE id = 1`)
      .run(hashPassword(newPassword))
    return true
  }

  /** After login POST/GET, preserve the user's current deep path so a
   * reverse-proxy mount like `/deepseek-harness/sessions/123` remains at the
   * same route after cookie minting. */
  private samePageStripLogin(req: ConnectionIndexRequest): string {
    const url = new URL((req as IncomingMessage & { url?: string }).url ?? '/', 'http://dsh.invalid')
    if (url.pathname.startsWith('/login')) url.pathname = '/'
    url.searchParams.delete('password')
    url.searchParams.delete('username')
    return url.pathname + (url.search === '' ? '' : url.search)
  }

  /**
   * Handle POST /login.json body `{password: string}`: on success mint cookie
   * and return `{ok: true, redirect: string}`; otherwise `{ok: false}`.
   */
  async handleLoginJson(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req as AsyncIterable<Buffer>) {
      total += chunk.byteLength
      if (total > 8 * 1024) { // 8 KiB cap: one password field never needs more.
        res.writeHead(413)
        res.end()
        return
      }
      chunks.push(chunk)
    }
    let password: unknown
    try {
      password = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { password?: unknown }).password
    } catch {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    if (typeof password !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    if (!this.verifyPassword(password)) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    // Use the same mint path: response writes Set-Cookie and reports the redirect target.
    const authority = requestAuthority(req.headers)
    if (authority === undefined) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    const issuedAt = Date.now()
    const expiresAt = issuedAt + this.maxAgeMilliseconds
    const value = encodeCookie({
      version: COOKIE_PAYLOAD_VERSION,
      authority,
      issuedAt,
      expiresAt,
    }, this.secret)
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': sessionCookie(
        cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000),
      ),
    })
    res.end(JSON.stringify({ ok: true, redirect: this.samePageStripLogin(req) }))
  }

  /**
   * Authenticate an index request. A valid cookie serves the harness app;
   * every unauthenticated GET/HEAD receives the login page so the password
   * flow can run under any mounted path. POST /login.json is handled on the
   * caller side via {@link handleLoginJson}.
   *
   * @returns true only when the caller may serve index.html.
   */
  authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean {
    if (this.isAuthenticated(req)) return true
    this.writeLoginPage(req, res)
    return false
  }

  /**
   * Verify the authority-bound browser cookie on a Host request.
   * @returns true only for an unexpired cookie signed by this activation's loaded secret.
   */
  isAuthenticated(request: ConnectionTrustRequest): boolean {
    const authority = requestAuthority(request.headers)
    const rawCookie = header(request.headers, 'cookie')
    if (authority === undefined || rawCookie === undefined) return false
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) return false
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined || payload.authority !== authority) return false
    const now = Date.now()
    return payload.issuedAt <= now
      && payload.expiresAt > now
      && payload.expiresAt > payload.issuedAt
      && payload.expiresAt - payload.issuedAt <= this.maxAgeMilliseconds
  }

  /**
   * Return the login page HTML (deepseek.com/harness-inspired minimal
   * design). The page mounts the password form, calls /login.json on submit,
   * and then navigates to the returned redirect. Works identically whether
   * the UI is served at / or behind a /deepseek-harness/ subpath (the login
   * form uses relative fetch resolved through the current <base> fallback).
   */
  loginPageHtml(_req: ConnectionIndexRequest): string {
    const year = new Date().getFullYear()
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>登录 · Harness</title>
<style>
  :root {
    --bg: #ffffff;
    --fg: #111827;
    --muted: #6b7280;
    --accent: #4f46e5;
    --accent-hover: #4338ca;
    --border: #e5e7eb;
    --card: #fafafa;
    --error: #b91c1c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0b10;
      --fg: #f3f4f6;
      --muted: #9ca3af;
      --accent: #818cf8;
      --accent-hover: #a5b4fc;
      --border: #1f2937;
      --card: #12131a;
      --error: #fca5a5;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
                 "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    color: var(--fg);
    background:
      radial-gradient(1200px 600px at 10% -10%, rgba(79, 70, 229, 0.12), transparent 60%),
      radial-gradient(900px 500px at 110% 10%, rgba(16, 185, 129, 0.10), transparent 60%),
      var(--bg);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .shell {
    width: 100%;
    max-width: 460px;
  }
  .eyebrow {
    color: var(--muted);
    letter-spacing: .12em;
    font-size: 12px;
    text-transform: uppercase;
    margin-bottom: 14px;
  }
  h1 {
    font-size: 30px;
    line-height: 1.2;
    margin: 0 0 12px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .lead {
    color: var(--muted);
    line-height: 1.6;
    margin: 0 0 28px;
    font-size: 14px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--fg);
  }
  input[type="password"] {
    width: 100%;
    height: 44px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    padding: 0 14px;
    font-size: 14px;
    transition: border-color .15s, box-shadow .15s;
    outline: none;
  }
  input[type="password"]:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .row { display: flex; gap: 10px; margin-top: 14px; }
  button {
    flex: 1;
    height: 44px;
    border-radius: 10px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: background .15s, transform .05s;
  }
  button:hover { background: var(--accent-hover); }
  button:active { transform: translateY(1px); }
  button[disabled] { opacity: .6; cursor: progress; }
  .status {
    margin-top: 12px;
    font-size: 13px;
    min-height: 18px;
    color: var(--error);
  }
  .footer {
    margin-top: 20px;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 22px;
  }
  .dot {
    width: 6px; height: 6px; border-radius: 999px; background: #10b981;
    box-shadow: 0 0 0 4px rgba(16, 185, 129, .12);
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="badge"><span class="dot"></span>Harness · 本地 Agent 工作空间</div>
    <div class="eyebrow">Welcome</div>
    <h1>登录进入你的 Harness</h1>
    <p class="lead">一切都是插件。模型、工具、会话、沙箱、循环、调度全由插件构成，可替换、可组合、可追踪。</p>
    <form class="card" id="f" autocomplete="off" spellcheck="false">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" required autofocus placeholder="请输入部署时设置的密码" />
      <div class="row"><button type="submit" id="btn">登 录</button></div>
      <div class="status" id="status" aria-live="polite"></div>
    </form>
    <div class="footer">© ${String(year)} · Powered by DeepSeek Harness</div>
  </div>
<script>
(function () {
  var form = document.getElementById('f');
  var btn = document.getElementById('btn');
  var status = document.getElementById('status');
  var input = document.getElementById('password');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    btn.disabled = true;
    status.textContent = '';
    try {
      var body = JSON.stringify({ password: input.value });
      var res = await fetch('login.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('密码错误，请重试。');
        throw new Error('登录失败（状态码 ' + String(res.status) + '）。');
      }
      var data = await res.json();
      if (!data || !data.ok) throw new Error('密码错误，请重试。');
      var target = (data && data.redirect) ? data.redirect : './';
      // Preserve the mount-point prefix: under /deepseek-harness/ the POST went
      // to <current-dir>/login.json i.e. <prefix>/login.json, so the redirect
      // starting with '/' would drop the prefix. Fix by staying relative: if
      // the path is absolute and the page is served under a prefix longer than
      // '/', rewrite to prefix + path.
      var prefix = location.pathname.replace(/\/+$/, '');
      if (prefix !== '' && target.charAt(0) === '/') {
        target = prefix + (target === '/' ? '' : target);
      } else if (target.charAt(0) !== '/') {
        target = target;
      }
      window.location.assign(target || '.');
    } catch (err) {
      status.textContent = (err && err.message) ? err.message : '登录失败。';
      btn.disabled = false;
      input.focus();
      input.select();
    }
  });
})();
</script>
</body>
</html>`
  }

  private writeLoginPage(req: ConnectionIndexRequest, res: ConnectionIndexResponse): void {
    const body = this.loginPageHtml(req)
    res.writeHead(req.method === 'GET' || req.method === undefined ? 200 : 401, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    })
    res.end(body)
  }
}

/** Expose the default session age so callers (tests, startup) can align UI copy. */
export const BROWSER_AUTH_DEFAULT_AGE_DAYS = SESSION_DAYS_DEFAULT
/** @internal exposed for unit tests of the hashing round-trip. */
export const internals = { hashPassword, verifyPassword }
