import type { EditorTab } from './tabManager'

const POLL_INTERVAL_MS = 1000

export interface FileExternalWatchDeps {
  getTabs: () => readonly EditorTab[]
  getActiveTabId: () => string | null
  isTabDirty: (tab: EditorTab) => boolean
  readFileAsBytes: (file: File) => Promise<Uint8Array>
  onReloadTab: (tab: EditorTab, bytes: Uint8Array) => void
  onPendingChange: (tabId: string, pending: boolean) => void
  onBannerUpdate: (info: ExternalChangeBannerInfo | null) => void
}

export interface ExternalChangeBannerInfo {
  tabId: string
  fileName: string
  dirty: boolean
}

interface TabWatchState {
  lastModified: number
  size: number
  diskKey: string
  pending: boolean
  dismissedDiskKey: string | null
  saving: boolean
}

function bytesFingerprint(bytes: Uint8Array): string {
  let h = 2166136261
  for (let i = 0; i < bytes.byteLength; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 16777619)
  }
  return `${bytes.byteLength}:${(h >>> 0).toString(36)}`
}

export interface FileExternalWatcher {
  markDiskSynced: (tabId: string, bytes: Uint8Array, file?: File) => void
  clearTab: (tabId: string) => void
  setSaving: (tabId: string, saving: boolean) => void
  reloadTab: (tabId: string) => Promise<boolean>
  dismissBanner: (tabId: string) => void
  refreshBanner: () => void
  stop: () => void
}

export function createFileExternalWatcher(deps: FileExternalWatchDeps): FileExternalWatcher {
  const states = new Map<string, TabWatchState>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let polling = false

  function getState(tabId: string): TabWatchState | undefined {
    return states.get(tabId)
  }

  function setPending(tabId: string, pending: boolean, state?: TabWatchState) {
    const s = state ?? states.get(tabId)
    if (!s) return
    if (s.pending === pending) return
    s.pending = pending
    if (!pending) s.dismissedDiskKey = null
    deps.onPendingChange(tabId, pending)
    refreshBanner()
  }

  function refreshBanner(): void {
    const activeId = deps.getActiveTabId()
    if (!activeId) {
      deps.onBannerUpdate(null)
      return
    }
    const tab = deps.getTabs().find((t) => t.id === activeId)
    const state = tab ? states.get(tab.id) : undefined
    if (!tab || !state?.pending || state.dismissedDiskKey === state.diskKey) {
      deps.onBannerUpdate(null)
      return
    }
    deps.onBannerUpdate({
      tabId: tab.id,
      fileName: tab.fileName,
      dirty: deps.isTabDirty(tab),
    })
  }

  async function pollOnce(): Promise<void> {
    if (polling) return
    polling = true
    try {
      for (const tab of deps.getTabs()) {
        if (!tab.fileHandle) continue
        const state = states.get(tab.id)
        if (!state || state.saving) continue

        let file: File
        try {
          file = await tab.fileHandle.getFile()
        } catch {
          continue
        }

        if (file.lastModified === state.lastModified && file.size === state.size) continue

        let bytes: Uint8Array
        try {
          bytes = await deps.readFileAsBytes(file)
        } catch {
          continue
        }

        const diskKey = bytesFingerprint(bytes)
        if (diskKey === state.diskKey) {
          state.lastModified = file.lastModified
          state.size = file.size
          continue
        }

        state.lastModified = file.lastModified
        state.size = file.size
        state.diskKey = diskKey
        state.dismissedDiskKey = null
        setPending(tab.id, true, state)
      }
    } finally {
      polling = false
    }
  }

  function markDiskSynced(tabId: string, bytes: Uint8Array, file?: File): void {
    const tab = deps.getTabs().find((t) => t.id === tabId)
    if (!tab?.fileHandle) {
      states.delete(tabId)
      deps.onPendingChange(tabId, false)
      refreshBanner()
      return
    }

    const diskKey = bytesFingerprint(bytes)
    states.set(tabId, {
      lastModified: file?.lastModified ?? Date.now(),
      size: file?.size ?? bytes.byteLength,
      diskKey,
      pending: false,
      dismissedDiskKey: null,
      saving: false,
    })
    deps.onPendingChange(tabId, false)
    refreshBanner()
  }

  async function reloadTab(tabId: string): Promise<boolean> {
    const tab = deps.getTabs().find((t) => t.id === tabId)
    if (!tab?.fileHandle) return false

    try {
      const file = await tab.fileHandle.getFile()
      const bytes = await deps.readFileAsBytes(file)
      deps.onReloadTab(tab, bytes)
      markDiskSynced(tabId, bytes, file)
      return true
    } catch {
      return false
    }
  }

  function dismissBanner(tabId: string): void {
    const state = states.get(tabId)
    if (!state?.pending) return
    state.dismissedDiskKey = state.diskKey
    refreshBanner()
  }

  pollTimer = setInterval(() => {
    void pollOnce()
  }, POLL_INTERVAL_MS)

  return {
    markDiskSynced,
    clearTab(tabId) {
      states.delete(tabId)
      deps.onPendingChange(tabId, false)
      refreshBanner()
    },
    setSaving(tabId, saving) {
      const state = states.get(tabId)
      if (state) state.saving = saving
    },
    reloadTab,
    dismissBanner,
    refreshBanner,
    stop() {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    },
  }
}
