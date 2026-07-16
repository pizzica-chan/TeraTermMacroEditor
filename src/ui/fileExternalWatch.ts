import type { EditorTab } from './tabManager'

const POLL_INTERVAL_MS = 1000

export interface FileExternalWatchDeps {
  getTabs: () => readonly EditorTab[]
  getActiveTabId: () => string | null
  isTabDirty: (tab: EditorTab) => boolean
  /** ディスク上にあるとみなす内容（savedContent 由来）のフィンガープリント */
  getTabBaselineKey: (tab: EditorTab) => string
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

function createEmptyWatchState(saving = false): TabWatchState {
  return {
    lastModified: 0,
    size: 0,
    diskKey: '',
    pending: false,
    dismissedDiskKey: null,
    saving,
  }
}

export { bytesFingerprint, POLL_INTERVAL_MS }

export interface FileExternalWatcher {
  markDiskSynced: (tabId: string, bytes: Uint8Array, file?: File) => void
  clearTab: (tabId: string) => void
  setSaving: (tabId: string, saving: boolean) => void
  hasPending: (tabId: string) => boolean
  reloadTab: (tabId: string) => Promise<boolean>
  dismissBanner: (tabId: string) => void
  refreshBanner: () => void
  pollNow: () => Promise<void>
  stop: () => void
}

export function createFileExternalWatcher(
  deps: FileExternalWatchDeps,
  options?: { debug?: boolean },
): FileExternalWatcher {
  const states = new Map<string, TabWatchState>()
  const bootstrapAttempted = new Set<string>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let polling = false
  const debug = options?.debug ?? false

  function log(...args: unknown[]): void {
    if (debug) console.log('[fileWatch]', ...args)
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

  function notifyExternalChange(tabId: string, state: TabWatchState): void {
    const becamePending = !state.pending
    state.pending = true
    state.dismissedDiskKey = null
    if (becamePending) deps.onPendingChange(tabId, true)
    log('external change', tabId, state.diskKey)
    refreshBanner()
  }

  async function bootstrapState(tab: EditorTab): Promise<TabWatchState | null> {
    if (!tab.fileHandle) return null
    try {
      const file = await tab.fileHandle.getFile()
      const bytes = await deps.readFileAsBytes(file)
      const diskKey = bytesFingerprint(bytes)
      const baselineKey = deps.getTabBaselineKey(tab)
      const state: TabWatchState = {
        lastModified: file.lastModified,
        size: file.size,
        diskKey,
        pending: false,
        dismissedDiskKey: null,
        saving: false,
      }
      states.set(tab.id, state)
      log('bootstrapped', tab.id, tab.fileName, { diskKey, baselineKey })
      if (diskKey !== baselineKey) {
        notifyExternalChange(tab.id, state)
      }
      return state
    } catch (err) {
      log('bootstrap failed', tab.id, err)
      return null
    }
  }

  async function pollOnce(): Promise<void> {
    if (polling) return
    polling = true
    try {
      for (const tab of deps.getTabs()) {
        if (!tab.fileHandle) continue
        let state = states.get(tab.id)
        if (!state) {
          if (bootstrapAttempted.has(tab.id)) {
            log('waiting for markDiskSynced', tab.id)
            continue
          }
          bootstrapAttempted.add(tab.id)
          state = (await bootstrapState(tab)) ?? undefined
          if (!state) continue
        }
        if (state.saving) continue

        let file: File
        try {
          file = await tab.fileHandle.getFile()
        } catch (err) {
          log('getFile failed', tab.id, err)
          continue
        }

        if (file.lastModified === state.lastModified && file.size === state.size) continue

        let bytes: Uint8Array
        try {
          bytes = await deps.readFileAsBytes(file)
        } catch (err) {
          log('read failed', tab.id, err)
          continue
        }

        const diskKey = bytesFingerprint(bytes)
        if (diskKey === state.diskKey) {
          state.lastModified = file.lastModified
          state.size = file.size
          log('mtime/size only', tab.id)
          continue
        }

        state.lastModified = file.lastModified
        state.size = file.size
        state.diskKey = diskKey
        notifyExternalChange(tab.id, state)
      }
    } finally {
      polling = false
    }
  }

  function markDiskSynced(tabId: string, bytes: Uint8Array, file?: File): void {
    bootstrapAttempted.delete(tabId)
    const tab = deps.getTabs().find((t) => t.id === tabId)
    if (!tab?.fileHandle) {
      const wasPending = states.get(tabId)?.pending ?? false
      states.delete(tabId)
      if (wasPending) deps.onPendingChange(tabId, false)
      refreshBanner()
      return
    }

    const wasPending = states.get(tabId)?.pending ?? false
    const diskKey = bytesFingerprint(bytes)
    states.set(tabId, {
      lastModified: file?.lastModified ?? Date.now(),
      size: file?.size ?? bytes.byteLength,
      diskKey,
      pending: false,
      dismissedDiskKey: null,
      saving: false,
    })
    log('synced', tabId, diskKey)
    if (wasPending) deps.onPendingChange(tabId, false)
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
    } catch (err) {
      log('reload failed', tabId, err)
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
      const wasPending = states.get(tabId)?.pending ?? false
      states.delete(tabId)
      bootstrapAttempted.delete(tabId)
      if (wasPending) deps.onPendingChange(tabId, false)
      refreshBanner()
    },
    setSaving(tabId, saving) {
      let state = states.get(tabId)
      if (!state && saving) {
        states.set(tabId, createEmptyWatchState(true))
        log('saving started (new state)', tabId)
        return
      }
      if (!state) return
      state.saving = saving
      if (!saving && state.diskKey === '' && !state.pending) {
        states.delete(tabId)
        bootstrapAttempted.delete(tabId)
        log('discarded empty saving placeholder', tabId)
        return
      }
      log('saving', tabId, saving)
    },
    hasPending(tabId) {
      return states.get(tabId)?.pending ?? false
    },
    reloadTab,
    dismissBanner,
    refreshBanner,
    pollNow: pollOnce,
    stop() {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    },
  }
}
