/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'archive.nav': '归档管理',
  'archive.empty': '暂无归档对话',
  'archive.loading': '加载中…',
  'archive.error': '加载失败，请重试',
  'archive.retry': '重试',
  'archive.restore': '恢复',
  'archive.restoring': '恢复中…',
  'archive.delete': '删除',
  'archive.deleting': '删除中…',
  'archive.deleteTitle': '彻底删除这条对话？',
  'archive.deleteDescription': '此操作会永久删除该对话及其全部消息记录，无法撤销。',
  'archive.deleteConfirm': '永久删除',
  'archive.cancel': '取消',
  'archive.untitled': '未命名对话',
  'archive.workspaceUnknown': '未归属工作区',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'archive.nav': 'Archive',
  'archive.empty': 'No archived conversations yet',
  'archive.loading': 'Loading…',
  'archive.error': 'Failed to load, please retry',
  'archive.retry': 'Retry',
  'archive.restore': 'Restore',
  'archive.restoring': 'Restoring…',
  'archive.delete': 'Delete',
  'archive.deleting': 'Deleting…',
  'archive.deleteTitle': 'Permanently delete this conversation?',
  'archive.deleteDescription': 'This will erase the conversation and all its messages permanently. The action cannot be undone.',
  'archive.deleteConfirm': 'Permanently delete',
  'archive.cancel': 'Cancel',
  'archive.untitled': 'Untitled conversation',
  'archive.workspaceUnknown': 'Unassigned workspace',
} satisfies Record<SettingsKey, string>
