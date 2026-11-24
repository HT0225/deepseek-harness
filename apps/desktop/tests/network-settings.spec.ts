import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  DesktopNetworkSettingsFile,
  networkEnvironment,
  resolveEffectiveNetwork,
  resolveSystemProxy,
} from '../src/network-settings.ts'

let userData: string
beforeEach(async () => { userData = await mkdtemp(join(tmpdir(), 'dsh-network-')) })
afterEach(async () => { await rm(userData, { recursive: true, force: true }) })

const inherited = {
  PATH: 'C:\\bin',
  HTTP_PROXY: 'http://inherited:8080',
  http_proxy: 'http://inherited:8080',
  HTTPS_PROXY: 'http://inherited:8080',
  ALL_PROXY: 'socks5://inherited:1080',
  NO_PROXY: 'example.com',
  pnpm_config_proxy: 'http://inherited:8080',
  NODE_USE_ENV_PROXY: '1',
}

it('removes every inherited proxy name for a direct connection', () => {
  const environment = networkEnvironment(inherited, { kind: 'direct' })
  expect(environment.PATH).toBe('C:\\bin')
  for (const name of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'pnpm_config_proxy']) {
    expect(environment[name]).toBeUndefined()
  }
  expect(environment.NODE_USE_ENV_PROXY).toBe('0')
})

it('publishes one proxy URL to every consumer and bypasses loopback', () => {
  const environment = networkEnvironment(inherited, { kind: 'proxy', url: 'http://127.0.0.1:7897' })
  expect(environment.HTTP_PROXY).toBe('http://127.0.0.1:7897')
  expect(environment.HTTPS_PROXY).toBe('http://127.0.0.1:7897')
  expect(environment.ALL_PROXY).toBe('http://127.0.0.1:7897')
  expect(environment.pnpm_config_https_proxy).toBe('http://127.0.0.1:7897')
  expect(environment.NODE_USE_ENV_PROXY).toBe('1')
  expect(environment.NO_PROXY).toBe('localhost,127.0.0.1,::1')
})

it('reads the first HTTP(S) proxy from a system resolution', async () => {
  expect(await resolveSystemProxy(async () => 'PROXY 127.0.0.1:7897; DIRECT')).toBe('http://127.0.0.1:7897')
  expect(await resolveSystemProxy(async () => 'HTTPS proxy.local:8443')).toBe('https://proxy.local:8443')
  expect(await resolveSystemProxy(async () => 'DIRECT')).toBeUndefined()
  // A SOCKS-only rule cannot be tunneled by the Host's HTTP proxy policy.
  expect(await resolveSystemProxy(async () => 'SOCKS5 127.0.0.1:1080')).toBeUndefined()
  expect(await resolveSystemProxy(async () => { throw new Error('unavailable') })).toBeUndefined()
})

it('resolves the effective mode for each preference', async () => {
  expect(await resolveEffectiveNetwork({ mode: 'proxy', proxyUrl: 'http://10.0.0.1:8080' },
    async () => 'DIRECT')).toEqual({ kind: 'proxy', url: 'http://10.0.0.1:8080' })
  expect(await resolveEffectiveNetwork({ mode: 'auto', proxyUrl: 'http://10.0.0.1:8080' },
    async () => 'PROXY 127.0.0.1:7897')).toEqual({ kind: 'proxy', url: 'http://127.0.0.1:7897' })
  expect(await resolveEffectiveNetwork({ mode: 'auto', proxyUrl: 'http://10.0.0.1:8080' },
    async () => 'DIRECT')).toEqual({ kind: 'direct' })
  expect(await resolveEffectiveNetwork({ mode: 'direct', proxyUrl: 'http://10.0.0.1:8080' },
    async () => 'PROXY 127.0.0.1:7897')).toEqual({ kind: 'direct' })
})

it('round-trips a stored preference and lets a launch mode win over it', async () => {
  const file = new DesktopNetworkSettingsFile(userData)
  expect((await file.load({})).mode).toBe('auto')
  await file.save({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:7897' })
  expect(await file.load({})).toEqual({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:7897' })
  expect((await file.load({ DSH_NETWORK_MODE: 'direct' })).mode).toBe('direct')
  expect((await file.load({ DSH_NETWORK_MODE: 'auto' })).mode).toBe('auto')
  expect((await file.load({ DSH_PROXY_URL: 'http://host:1' })).proxyUrl).toBe('http://host:1')
})

it('falls back to the launch default for an unusable settings file', async () => {
  const file = new DesktopNetworkSettingsFile(userData)
  await writeFile(file.path(), '{ not json', 'utf8')
  expect((await file.load({ DSH_NETWORK_MODE: 'proxy' })).mode).toBe('proxy')
  await writeFile(file.path(), JSON.stringify({ mode: 'socks', proxyUrl: 'ftp://nope' }), 'utf8')
  expect((await file.load({})).mode).toBe('auto')
})
