/**
 * Settings shell and ownerless-copy plugin, browser half: renders the
 * `sidebar.settings` occupant — panel chrome, section navigation, and the
 * onboarding stage — and registers everything on the Settings pages that
 * belongs to no single feature: the trigger/header chrome content,
 * local-document action, General section, Archive management section, and
 * `settings` dictionaries. Feature-owned rows and sections stay with their
 * features.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the `ctx.sessions` Context merge (the open() verb is used
// to jump the main chat view after restoring an archived session).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `ctx.workspaces` Context merge so the archive list can
// refresh when the standard Workspace follow stream publishes a new archive
// set length.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Ensures the generated `ctx.remote.workspace` namespace is visible to TS
// (Remote-wire codec merge, no value import).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {
  SettingsOnboardingStep, SettingsRootInjected, SettingsSectionRow,
} from './shell-contract.ts'
import { SettingsRoot } from './SettingsRoot.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from './chrome.tsx'
import { GeneralSection } from './GeneralSection.tsx'
import { SettingsDocumentAction } from './SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from './SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from './settings-document-store.ts'
import {
  ArchivedSessionsSection,
  type ArchivedSessionsInjected,
  type ArchivedSessionsView,
} from './ArchivedSessionsSection.tsx'
import { en, zh, type SettingsKey } from './locales.ts'

export type {
  CloseLabelProps, HeaderContentProps, TriggerContentProps,
} from './chrome.tsx'
export type {
  GeneralSectionComponentProps,
} from './GeneralSection.tsx'
export type { SettingsDocumentActionInjected, SettingsDocumentActionProps } from './SettingsDocumentAction.tsx'
export type { SettingsDocumentState } from './settings-document-store.ts'
export { SettingsDocumentStore } from './settings-document-store.ts'
export type { SettingsKey } from './locales.ts'
export type { ArchivedSessionsInjected, ArchivedSessionsView } from './ArchivedSessionsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell chrome + shell-owned General + Archive sections copy. */
    settings: SettingsKey
  }
}

/** Dictionary namespace owned by this plugin (shell chrome + General/Archive copy). */
const NS = 'settings'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registrations depend on their slots through `slots.inject()`.
 * `ctx.sessions` and `ctx.workspaces` are reached via type-only Context
 * merges from the session- and workspace-controller client plugins.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.settings', 'remote.workspace', 'settingsScope', 'workspaces', 'sessions']

/**
 * Register the `settings` dictionaries, the chrome content, and the General
 * section, each once its slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-general: dictionaries')

  // Copy freshness is framework-owned: components read the standard `t`
  // seat, and the nav label is a thunk the owner resolves per render — no
  // locale/change re-registration wiring.
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  // The shared SettingsScope mirror updates after document commits and reconnects.
  const documentController = connection.isLoopback
    ? new SettingsDocumentStore(ctx.remote, ctx.settingsScope.describe())
    : undefined
  const documentInjected = documentController === undefined
    ? undefined
    : (): SettingsDocumentActionInjected => ({
      controller: documentController,
      hooks: { snapshot: documentController.store },
    })
  ctx.effect(() => () => { documentController?.dispose() }, 'ui-settings-general: document action directory')
  // The settings shell: this package occupies the sidebar-owned hole and
  // declares the settings slots. Ledger → nav-row projection as an observable
  // source (uSES contract: getSnapshot returns the cached rows until the
  // ledger version moves). Labels may be locale-following thunks, so the cache
  // key includes the locale revision and subscribers ride both sources.
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: readonly SettingsSectionRow[] = []
  let onboardingVersion = -1
  let onboardingSteps: readonly SettingsOnboardingStep[] = []
  const shellInjected = (): SettingsRootInjected => ({
    hooks: {
      sections: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.section')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== rowsVersion || revision !== rowsRevision) {
            rowsVersion = version
            rowsRevision = revision
            rows = ctx.slots.entries('settings.section')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
                label: resolveSlotLabel(e.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return rows
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.section', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
      onboardingSteps: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.onboarding')
          if (version !== onboardingVersion) {
            onboardingVersion = version
            onboardingSteps = ctx.slots.entries('settings.onboarding')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
              }))
              .sort((a, b) => a.order - b.order)
          }
          return onboardingSteps
        },
        subscribe: listener => ctx.slots.subscribe('settings.onboarding', listener),
      },
    },
  })
  ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings',
    children: {
      'settings.trigger': { kind: 'single', scope: 'root' },
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
    inject: shellInjected,
  }, SettingsRoot))

  ctx.slots.inject('settings.trigger', () =>
    ctx.slots.register({ name: 'settings.trigger', locale: NS }, TriggerContent))
  ctx.slots.inject('settings.header', () =>
    ctx.slots.register({ name: 'settings.header', locale: NS }, HeaderContent))
  if (documentInjected !== undefined) {
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action',
      id: 'open-document',
      order: 0,
      locale: NS,
      inject: documentInjected,
    }, SettingsDocumentAction))
  }
  ctx.slots.inject('settings.close', () =>
    ctx.slots.register({ name: 'settings.close', locale: NS }, CloseLabel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    label: () => t('general.nav'),
    locale: NS,
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, GeneralSection))

  // Archived sessions management — order 30, after General (0), Models (10),
  // Plugins (15), and Agent presets (20). The controller owns its own small
  // snapshot store: it queries the Workspace remote directly, folds mutations
  // back into the view, and drives the confirm-delete Modal staged row.
  const archiveStore = createSnapshotStore<ArchivedSessionsView>({
    phase: 'loading',
    items: [],
    pendingDelete: null,
    deleting: false,
    restoringId: null,
    errorMessage: null,
  })
  let loadGeneration = 0
  const loadArchive = () => {
    const myGen = ++loadGeneration
    archiveStore.update((draft) => {
      if (draft.items.length === 0) draft.phase = 'loading'
      draft.errorMessage = null
    })
    void ctx.remote.workspace.listArchivedSessions().then((result) => {
      if (myGen !== loadGeneration) return
      archiveStore.update((draft) => {
        if (result.ok) {
          draft.phase = 'ready'
          draft.items = result.value.items
          draft.errorMessage = null
        } else {
          draft.phase = 'error'
          draft.errorMessage = result.error.message ?? t('archive.error')
        }
      })
    }, (error: unknown) => {
      if (myGen !== loadGeneration) return
      archiveStore.update((draft) => {
        draft.phase = 'error'
        draft.errorMessage = error instanceof Error ? error.message : String(error)
      })
    })
  }
  // First load waits for the settings panel injection: the Workspace remote
  // namespace is an apply-time inject dependency, but keeping startup free of
  // this RPC respects the startup RPC budget.
  let archiveLoaded = false
  const ensureArchiveLoaded = () => {
    if (archiveLoaded) return
    archiveLoaded = true
    loadArchive()
  }
  // Refresh whenever the host-validated archived set moves through the
  // standard Workspace follow stream (new archives surface in real time).
  let lastArchivedLen = ctx.workspaces?.list.getSnapshot().archivedSessionIds.length ?? -1
  const offWorkspaceList = ctx.workspaces === undefined
    ? undefined
    : ctx.workspaces.list.subscribe(() => {
      const next = ctx.workspaces?.list.getSnapshot().archivedSessionIds.length ?? -1
      if (next !== lastArchivedLen) {
        lastArchivedLen = next
        loadArchive()
      }
    })
  ctx.effect(
    () => () => { offWorkspaceList?.() },
    'ui-settings-general: archive list refresh subscription',
  )
  const archiveInjected = (): ArchivedSessionsInjected => {
    ensureArchiveLoaded()
    return {
      hooks: { snapshot: archiveStore },
      /** @returns true when restore succeeded, false (or throws) otherwise. */
      async restore(sessionId: SessionId): Promise<boolean> {
        archiveStore.update((draft) => { draft.restoringId = sessionId })
        try {
          const res = await ctx.remote.workspace.unarchiveSession({ sessionId })
          if (!res.ok) throw new Error(res.error.message ?? 'restore failed')
        } catch (error) {
          archiveStore.update((draft) => {
            draft.restoringId = null
            draft.phase = 'error'
            draft.errorMessage = error instanceof Error ? error.message : String(error)
          })
          return false
        }
        archiveStore.update((draft) => {
          draft.restoringId = null
          draft.items = draft.items.filter(i => i.sessionId !== sessionId)
        })
        // Jump the main chat view to the now-visible restored session.
        // The section component closes the settings modal immediately after
        // this promise resolves to true (it owns the `close` runtime prop).
        ctx.sessions.open(sessionId)
        return true
      },
      requestDelete(item) {
        archiveStore.update((draft) => { if (!draft.deleting) draft.pendingDelete = item })
      },
      cancelDelete() {
        archiveStore.update((draft) => { if (!draft.deleting) draft.pendingDelete = null })
      },
      async confirmDelete(): Promise<void> {
        const staged = archiveStore.getSnapshot().pendingDelete
        if (staged === null) return
        archiveStore.update((draft) => { draft.deleting = true })
        const sid = staged.sessionId
        let ok = false
        let message: string | null = null
        try {
          const res = await ctx.remote.workspace.deleteArchivedSession({ sessionId: sid })
          ok = res.ok
          if (!res.ok) message = res.error.message ?? 'delete failed'
        } catch (error) {
          ok = false
          message = error instanceof Error ? error.message : String(error)
        }
        archiveStore.update((draft) => {
          draft.deleting = false
          if (ok) {
            draft.pendingDelete = null
            draft.items = draft.items.filter(i => i.sessionId !== sid)
          } else {
            draft.phase = 'error'
            draft.errorMessage = message
          }
        })
      },
      retry: loadArchive,
    }
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archive',
    order: 30,
    label: () => t('archive.nav'),
    locale: NS,
    inject: archiveInjected,
  }, ArchivedSessionsSection))
}
