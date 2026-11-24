/**
 * Shell-owned network mode for the Desktop Host: which outbound proxy the Host and its plugin
 * subprocesses inherit.
 *
 * The Host is spawned with an environment this module builds, so a mode change takes effect when the
 * Host restarts; nothing here touches Chromium's own networking or the Host while it runs. The mode
 * lives in its own file because the update channel settings document belongs to update policy, and a
 * network preference must survive an invalid update field (and vice versa).
 * @module @deepseek-ai/dsh-desktop/network-settings
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'

/** How the Host reaches the network. `auto` resolves the operating system's proxy on every start. */
export type DesktopNetworkMode = 'auto' | 'proxy' | 'direct'

/** The persisted preference: a mode and the proxy URL the explicit `proxy` mode uses. */
export interface DesktopNetworkSettings {
  readonly mode: DesktopNetworkMode
  readonly proxyUrl: string
}

/**
 * The mode actually applied to one Host start. `auto` has already consulted the system proxy, so
 * only the two concrete outcomes remain.
 */
export type EffectiveNetwork =
  | { readonly kind: 'proxy'; readonly url: string }
  | { readonly kind: 'direct' }

/** Proxy URL used when the user never supplied one; the conventional local Clash/Mihomo port. */
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:7897'

/**
 * Every lowercased environment name that carries proxy configuration for the Host or a child it
 * spawns. Windows folds environment names case-insensitively, so matching on the lowercase spelling
 * drops both `HTTP_PROXY` and `http_proxy` without listing each casing.
 */
const PROXY_ENV_KEYS: ReadonlySet<string> = new Set([
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'pnpm_config_proxy', 'pnpm_config_https_proxy',
])

/** Loopback hosts that must never reach the proxy: the Host, the Web UI, and local test servers. */
const LOOPBACK_NO_PROXY = 'localhost,127.0.0.1,::1'

const settingsSchema = z.object({
  mode: z.enum(['auto', 'proxy', 'direct']),
  proxyUrl: z.string().min(1).refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, { message: 'proxy URL must be an http(s) URL' }),
})

/**
 * Defaults for a launch that has no stored preference.
 *
 * A launcher that names a mode wins over the stored one for that launch: the two Windows shortcuts
 * carry their own choice, and a tray change made in one session must not silently override the
 * shortcut the user clicks next time. `auto` is the fallback because following the operating
 * system's proxy is the least surprising behavior when the user has configured one globally.
 * @param env - Launch environment, which a launcher may have annotated.
 * @returns The preference to start with.
 */
export function defaultNetworkSettings(env: NodeJS.ProcessEnv = process.env): DesktopNetworkSettings {
  const mode = env.DSH_NETWORK_MODE
  const proxyUrl = env.DSH_PROXY_URL
  return {
    mode: mode === 'auto' || mode === 'proxy' || mode === 'direct' ? mode : 'auto',
    proxyUrl: proxyUrl !== undefined && proxyUrl !== '' ? proxyUrl : DEFAULT_PROXY_URL,
  }
}

/** The stored preference, or the launch default when the file is missing or unusable. */
export class DesktopNetworkSettingsFile {
  /** @param userData - Electron userData, independent of Host and DSH_HOME. */
  constructor(private readonly userData: string) {}

  /** @returns Absolute path of the settings file; the file may not exist yet. */
  path(): string {
    return join(this.userData, 'network.json')
  }

  /**
   * Read the preference, preferring a mode the launch environment names explicitly.
   * @param env - Launch environment.
   * @returns A usable preference; a missing, malformed, or invalid file falls back to the default.
   */
  async load(env: NodeJS.ProcessEnv = process.env): Promise<DesktopNetworkSettings> {
    const defaults = defaultNetworkSettings(env)
    // A launcher-provided mode is explicit even when it names `auto`; only an absent variable lets
    // the stored preference decide.
    const explicitMode = env.DSH_NETWORK_MODE === 'auto' || env.DSH_NETWORK_MODE === 'proxy'
      || env.DSH_NETWORK_MODE === 'direct'
    let raw: string
    try {
      raw = await readFile(this.path(), 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('desktop network: settings read failed', error)
      return defaults
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (_error) {
      console.warn('desktop network: settings file is not JSON; using launch default')
      return defaults
    }
    const parsed = settingsSchema.safeParse(value)
    if (!parsed.success) {
      console.warn('desktop network: settings file is invalid; using launch default')
      return defaults
    }
    return {
      mode: explicitMode ? defaults.mode : parsed.data.mode,
      proxyUrl: env.DSH_PROXY_URL ?? parsed.data.proxyUrl,
    }
  }

  /**
   * Replace the stored preference atomically.
   * @param settings - The preference to persist.
   */
  async save(settings: DesktopNetworkSettings): Promise<void> {
    await mkdir(dirname(this.path()), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.path(), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  }
}

/**
 * Turn one preference into the mode a Host start applies.
 *
 * `auto` asks Chromium how it would route an ordinary HTTPS request, which is the same system proxy
 * the rest of the machine uses (including a PAC file or the Windows Internet Settings registry).
 * @param settings - The preference in force.
 * @param resolveProxy - Chromium's proxy resolver, normally `session.defaultSession.resolveProxy`.
 * @returns The concrete mode for this start.
 */
export async function resolveEffectiveNetwork(
  settings: DesktopNetworkSettings,
  resolveProxy: (url: string) => Promise<string>,
): Promise<EffectiveNetwork> {
  if (settings.mode === 'direct') return { kind: 'direct' }
  if (settings.mode === 'proxy') return { kind: 'proxy', url: settings.proxyUrl }
  const url = await resolveSystemProxy(resolveProxy)
  return url === undefined ? { kind: 'direct' } : { kind: 'proxy', url }
}

/**
 * Read the first HTTP(S) proxy out of Chromium's `resolveProxy` answer.
 * @param resolveProxy - Chromium's proxy resolver.
 * @returns An `http(s)://host:port` URL, or `undefined` for a direct route (or SOCKS-only rules,
 *   which this Host cannot tunnel through).
 */
export async function resolveSystemProxy(
  resolveProxy: (url: string) => Promise<string>,
): Promise<string | undefined> {
  let resolved: string
  try {
    resolved = await resolveProxy('https://github.com')
  } catch (error) {
    console.warn('desktop network: system proxy resolution failed', error)
    return undefined
  }
  for (const part of resolved.split(';')) {
    const [kind, address] = part.trim().split(/\s+/, 2)
    if (address === undefined) continue
    if (kind === 'PROXY' || kind === 'HTTP') return `http://${address}`
    if (kind === 'HTTPS') return `https://${address}`
  }
  return undefined
}

/**
 * Build the Host environment for one resolved mode.
 *
 * A direct mode removes every inherited proxy name rather than merely skipping new ones: the login
 * shell may already export `HTTP_PROXY` for other tools, and those must not reach the Host when the
 * user chose a direct connection. `NODE_USE_ENV_PROXY` is always written because Node 24 consults it
 * for the built-in `fetch` the Host's plugins use.
 * @param base - The environment the Host would otherwise inherit.
 * @param network - The concrete mode for this start.
 * @returns A new environment object; `base` is not modified.
 */
export function networkEnvironment(base: NodeJS.ProcessEnv, network: EffectiveNetwork): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(base)) {
    if (!PROXY_ENV_KEYS.has(name.toLowerCase())) environment[name] = value
  }
  if (network.kind === 'direct') {
    environment.NODE_USE_ENV_PROXY = '0'
    return environment
  }
  environment.NODE_USE_ENV_PROXY = '1'
  environment.HTTP_PROXY = network.url
  environment.HTTPS_PROXY = network.url
  environment.ALL_PROXY = network.url
  environment.pnpm_config_proxy = network.url
  environment.pnpm_config_https_proxy = network.url
  environment.NO_PROXY = LOOPBACK_NO_PROXY
  return environment
}
