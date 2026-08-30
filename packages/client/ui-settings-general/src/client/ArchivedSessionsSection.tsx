/**
 * Archived sessions management section. Lists every archived session with
 * title / last-active time / owning workspace plus Restore and Delete
 * actions. Restore closes the settings panel and jumps the main chat area
 * to the now-visible session. Delete opens a confirm dialog before the
 * permanent physical erase on the host.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkspaceArchivedSession,
} from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SettingsKey } from './locales.ts'
import css from './ArchivedSessionsSection.module.css'

/**
 * View state projected for the section component. Writable on purpose: the
 * owning snapshot store mutates it through immer drafts; dev builds keep
 * published snapshots frozen.
 */
export interface ArchivedSessionsView {
  phase: 'loading' | 'ready' | 'error'
  items: readonly WorkspaceArchivedSession[]
  pendingDelete: WorkspaceArchivedSession | null
  deleting: boolean
  restoringId: SessionId | null
  errorMessage: string | null
}

/** Registration-side injected face for the archive section. */
export interface ArchivedSessionsInjected {
  hooks: {
    snapshot: HostObservable<ArchivedSessionsView>
  }
  /**
   * Restore one archived session and open it in the main chat view.
   * @returns true when the restore succeeded (the caller should then close
   *   the settings modal); false on business/transport failure (modal stays
   *   open and the view reports the inline error).
   */
  restore: (sessionId: SessionId) => Promise<boolean>
  /** Stage one row for the confirm-delete dialog. */
  requestDelete: (item: WorkspaceArchivedSession) => void
  /** Dismiss the confirm-delete dialog without deleting. */
  cancelDelete: () => void
  /** Confirm the staged deletion (permanent, irreversible). */
  confirmDelete: () => Promise<void>
  /** Retry a failed listing load. */
  retry: () => void
}

/** Full component props for the Archived Sessions settings section. */
export type ArchivedSessionsSectionProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>
  & InjectFace<ArchivedSessionsInjected>

/** Format epoch-ms as a locale-aware compact timestamp (date + time). */
function formatTimestamp(ms: number, placeholder: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return placeholder
  try {
    const d = new Date(ms)
    const date = d.toLocaleDateString(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const time = d.toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    return `${date} ${time}`
  } catch {
    return placeholder
  }
}

type T = (key: SettingsKey) => string

/**
 * Render one list-row node (pure helper, extracted so the return fits on one
 * logical line per paragraph).
 */
function renderRow(
  item: WorkspaceArchivedSession,
  t: T,
  view: ArchivedSessionsView,
  actions: Pick<ArchivedSessionsInjected, 'restore' | 'requestDelete'>,
  close: () => void,
): ReactNode {
  const restoring = view.restoringId === item.sessionId
  const busyAny = view.deleting || view.restoringId !== null
  const titleText = item.title ?? (() => {
    const base = t('archive.untitled')
    const stamp = formatTimestamp(item.updatedAt, '')
    return stamp ? `${base} ${stamp}` : base
  })()
  const timeText = formatTimestamp(item.updatedAt, '—')
  const workspaceText = item.workspaceTitle ?? t('archive.workspaceUnknown')
  return (
    <li className={css.row} key={item.sessionId}>
      <div className={css.rowTitle} title={titleText}>{titleText}</div>
      <div className={css.rowMeta}>
        <span>{timeText}</span>
        <span className={css.separator}>·</span>
        <span>{workspaceText}</span>
      </div>
      <div className={css.actions}>
        <Button
          variant="outline"
          className={css.restoreButton as string}
          disabled={busyAny}
          onClick={() => {
            void actions.restore(item.sessionId).then((ok) => {
              if (ok) close()
            })
          }}
        >
          {restoring ? t('archive.restoring') : t('archive.restore')}
        </Button>
        <Button
          variant="outline"
          className={css.deleteButton as string}
          disabled={busyAny}
          onClick={() => actions.requestDelete(item)}
        >
          {view.deleting && view.pendingDelete?.sessionId === item.sessionId
            ? t('archive.deleting')
            : t('archive.delete')}
        </Button>
      </div>
    </li>
  )
}

/**
 * Render the Archived Sessions section content column.
 * @param props - composed slot props plus the injected store hook and actions.
 * @returns the section element tree.
 */
export function ArchivedSessionsSection(props: ArchivedSessionsSectionProps): ReactNode {
  const view = props.useSnapshot(snapshot => snapshot)
  const t = props.t
  const rows = useMemo(
    () => view.items.map(item => renderRow(item, t, view, props, props.close)),
    [view, t],
  )

  let statusNode: ReactNode = null
  if (view.phase === 'loading' && view.items.length === 0) {
    statusNode = (
      <div className={css.statusLine}>
        <span>{t('archive.loading')}</span>
      </div>
    )
  } else if (view.phase === 'error' && view.items.length === 0) {
    statusNode = (
      <div className={css.statusLine}>
        <span role="alert">{view.errorMessage ?? t('archive.error')}</span>
        <button
          type="button"
          className={css.retryButton}
          onClick={() => props.retry()}
        >
          {t('archive.retry')}
        </button>
      </div>
    )
  } else if (view.phase === 'ready' && view.items.length === 0) {
    statusNode = (
      <div className={css.statusLine}>
        <span>{t('archive.empty')}</span>
      </div>
    )
  }

  const pending = view.pendingDelete
  return (
    <div className={css.section}>
      <div className={css.header}>
        <div>
          <h2 className={css.title}>{t('archive.nav')}</h2>
        </div>
      </div>
      {statusNode}
      {view.items.length > 0 ? <ul className={css.list}>{rows}</ul> : null}
      <Modal
        open={pending !== null}
        onClose={() => { if (!view.deleting) props.cancelDelete() }}
        title={t('archive.deleteTitle')}
        closeLabel={t('close')}
        description={t('archive.deleteDescription')}
        className={css.deleteDialog as string}
        footer={(
          <>
            <Button
              variant="outline"
              disabled={view.deleting}
              onClick={() => props.cancelDelete()}
            >
              {t('archive.cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteConfirm as string}
              disabled={view.deleting}
              onClick={() => { void props.confirmDelete() }}
            >
              {view.deleting ? t('archive.deleting') : t('archive.deleteConfirm')}
            </Button>
          </>
        )}
      >
        {pending === null ? null : (
          <p className={css.description}>
            <strong>{pending.title ?? t('archive.untitled')}</strong>
            <span> · {formatTimestamp(pending.updatedAt, '—')}</span>
          </p>
        )}
      </Modal>
    </div>
  )
}
