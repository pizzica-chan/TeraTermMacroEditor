import type { TextEncoding, NewlineType } from '../text/types'

export interface SavedTabState {
  id: string
  fileName: string
  content: string
  savedContent: string
  encoding: TextEncoding
  newline: NewlineType
  includeBindings: Record<string, string>
  branchAssumptions?: Record<string, boolean>
  variableAssumptions?: Record<string, string>
  flushrecvWarningIgnores?: Record<string, boolean>
  consecutiveSendWarningIgnores?: Record<string, boolean>
  importedEnvParentKey?: string
}

export interface WorkspaceSession {
  version: 1
  activeTabId: string
  tabs: SavedTabState[]
  savedAt: number
}

const SESSION_KEY = 'ttl-macro-editor-session'

function isEncoding(v: unknown): v is TextEncoding {
  return v === 'UTF-8' || v === 'SJIS'
}

function isNewline(v: unknown): v is NewlineType {
  return v === 'LF' || v === 'CRLF' || v === 'CR'
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object') return false
  return Object.values(v).every((x) => typeof x === 'string')
}

function isSavedTab(v: unknown): v is SavedTabState {
  if (!v || typeof v !== 'object') return false
  const t = v as SavedTabState
  return (
    typeof t.id === 'string' &&
    typeof t.fileName === 'string' &&
    typeof t.content === 'string' &&
    typeof t.savedContent === 'string' &&
    isEncoding(t.encoding) &&
    isNewline(t.newline) &&
    typeof t.includeBindings === 'object' &&
    t.includeBindings !== null
  )
}

export function loadWorkspaceSession(): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceSession>
    if (parsed.version !== 1 || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null
    const tabs = parsed.tabs.filter(isSavedTab)
    if (tabs.length === 0) return null

    const tabIds = new Set(tabs.map((t) => t.id))
    for (const tab of tabs) {
      const bindings: Record<string, string> = {}
      for (const [path, tabId] of Object.entries(tab.includeBindings)) {
        if (tabIds.has(tabId)) bindings[path] = tabId
      }
      tab.includeBindings = bindings
      tab.variableAssumptions = isStringRecord(tab.variableAssumptions)
        ? tab.variableAssumptions
        : {}
      if (typeof tab.importedEnvParentKey === 'string' && tab.importedEnvParentKey.includes(':')) {
        const parentTabId = tab.importedEnvParentKey.slice(0, tab.importedEnvParentKey.lastIndexOf(':'))
        if (!tabIds.has(parentTabId)) delete tab.importedEnvParentKey
      } else {
        delete tab.importedEnvParentKey
      }
    }

    const activeTabId =
      typeof parsed.activeTabId === 'string' && tabIds.has(parsed.activeTabId)
        ? parsed.activeTabId
        : tabs[0]!.id

    return { version: 1, activeTabId, tabs, savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0 }
  } catch {
    return null
  }
}

export function saveWorkspaceSession(session: WorkspaceSession): boolean {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return true
  } catch {
    return false
  }
}

export function clearWorkspaceSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}
