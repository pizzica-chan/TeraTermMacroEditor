import type { EditorState } from '@codemirror/state'
import type { EditorInstance } from '../editor/createEditor'
import { DocumentSettings } from '../text/documentSettings'
import type { WorkspaceSession } from '../storage/sessionState'
import { migrateIncludeBindings } from '../ttl/includeRefs'

export const MAX_TABS = 10

export interface EditorTab {
  id: string
  fileName: string
  docSettings: DocumentSettings
  fileHandle: FileSystemFileHandle | null
  editorState: EditorState
  /** 最後に保存または読み込みしたときの内容 */
  savedContent: string
  /** include パス（正規化）→ リンク先タブ ID */
  includeBindings: Record<string, string>
  /** 未確定 if/elseif 行番号（文字列キー）→ ユーザー仮定の真偽 */
  branchAssumptions?: Record<string, boolean>
}

let nextTabId = 1

export function createTabId(): string {
  return `tab-${nextTabId++}`
}

export function syncNextTabIdFromExisting(ids: string[]): void {
  let max = nextTabId - 1
  for (const id of ids) {
    const m = /^tab-(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  nextTabId = max + 1
}

export class TabManager {
  private tabs: EditorTab[] = []
  private activeId: string | null = null
  private editor: EditorInstance
  private tabListEl: HTMLElement
  private onActiveTabChange: (tab: EditorTab, options?: { keepDryRun?: boolean }) => void
  private onBeforeTabLeave?: () => void
  private keepDryRunOnUserSwitch?: () => boolean
  private onTabClosed?: (closedTabId: string) => void
  private externalChangeTabIds = new Set<string>()

  constructor(
    editor: EditorInstance,
    tabListContainer: HTMLElement,
    onActiveTabChange: (tab: EditorTab, options?: { keepDryRun?: boolean }) => void,
    onBeforeTabLeave?: () => void,
  ) {
    this.editor = editor
    this.tabListEl = tabListContainer
    this.onActiveTabChange = onActiveTabChange
    this.onBeforeTabLeave = onBeforeTabLeave
  }

  setKeepDryRunOnUserSwitch(fn: () => boolean): void {
    this.keepDryRunOnUserSwitch = fn
  }

  setOnTabClosed(fn: (closedTabId: string) => void): void {
    this.onTabClosed = fn
  }

  setExternalChangePending(tabId: string, pending: boolean): void {
    const has = this.externalChangeTabIds.has(tabId)
    if (pending === has) return
    if (pending) this.externalChangeTabIds.add(tabId)
    else this.externalChangeTabIds.delete(tabId)
    this.renderTabs()
  }

  hasExternalChangePending(tab: EditorTab): boolean {
    return this.externalChangeTabIds.has(tab.id)
  }

  private userSwitchOptions(): { keepDryRun: true } | undefined {
    return this.keepDryRunOnUserSwitch?.() ? { keepDryRun: true } : undefined
  }

  get count(): number {
    return this.tabs.length
  }

  get activeTab(): EditorTab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null
  }

  get allTabs(): readonly EditorTab[] {
    return this.tabs
  }

  canAddTab(): boolean {
    return this.tabs.length < MAX_TABS
  }

  /** タブの内容が保存済みスナップショットと異なるか */
  isTabDirty(tab: EditorTab): boolean {
    if (tab.id === this.activeId) {
      return this.editor.getValue() !== tab.savedContent
    }
    return tab.editorState.doc.toString() !== tab.savedContent
  }

  hasUnsavedChanges(): boolean {
    this.saveCurrentState()
    return this.tabs.some((t) => this.isTabDirty(t))
  }

  private saveCurrentState(): void {
    const tab = this.activeTab
    if (!tab) return
    tab.editorState = this.editor.getState()
  }

  /** エディタ内容をアクティブタブへ反映（セッション保存前に呼ぶ） */
  flushEditorState(): void {
    this.saveCurrentState()
  }

  private renderTabs(): void {
    this.tabListEl.innerHTML = ''
    for (const tab of this.tabs) {
      const el = document.createElement('div')
      el.className = `tab-item${tab.id === this.activeId ? ' active' : ''}`
      el.dataset.id = tab.id
      el.title = tab.fileName

      const title = document.createElement('span')
      title.className = 'tab-title'
      const markers = [
        this.isTabDirty(tab) ? '•' : '',
        this.hasExternalChangePending(tab) ? '↻' : '',
      ].filter(Boolean)
      title.textContent = (markers.length > 0 ? `${markers.join(' ')} ` : '') + tab.fileName

      const closeBtn = document.createElement('button')
      closeBtn.className = 'tab-close'
      closeBtn.type = 'button'
      closeBtn.title = 'タブを閉じる'
      closeBtn.textContent = '×'
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.closeTab(tab.id)
      })

      el.append(title, closeBtn)
      el.addEventListener('click', () => this.switchTab(tab.id, this.userSwitchOptions()))
      this.tabListEl.appendChild(el)
    }
  }

  addTab(options: {
    id?: string
    fileName?: string
    editorState?: EditorState
    docSettings?: DocumentSettings
    fileHandle?: FileSystemFileHandle | null
    savedContent?: string
    includeBindings?: Record<string, string>
    branchAssumptions?: Record<string, boolean>
    activate?: boolean
  }): EditorTab | null {
    if (!this.canAddTab()) {
      alert(`タブは最大 ${MAX_TABS} 個まで開けます。`)
      return null
    }

    this.onBeforeTabLeave?.()
    this.saveCurrentState()

    const editorState = options.editorState ?? this.editor.createState('')
    const content = editorState.doc.toString()
    const tab: EditorTab = {
      id: options.id ?? createTabId(),
      fileName: options.fileName ?? '未保存',
      docSettings: options.docSettings ?? new DocumentSettings(),
      fileHandle: options.fileHandle ?? null,
      editorState,
      savedContent: options.savedContent ?? content,
      includeBindings: options.includeBindings ? { ...options.includeBindings } : {},
      branchAssumptions: options.branchAssumptions ? { ...options.branchAssumptions } : {},
    }

    this.tabs.push(tab)

    if (options.activate !== false) {
      this.activeId = tab.id
      this.editor.setState(tab.editorState)
      this.editor.focus()
      this.onActiveTabChange(tab)
    }

    this.renderTabs()
    return tab
  }

  switchTab(id: string, options?: { keepDryRun?: boolean }): void {
    if (this.activeId === id) return
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return

    this.onBeforeTabLeave?.()
    this.saveCurrentState()
    this.activeId = id
    this.editor.setState(tab.editorState)
    this.editor.focus()
    this.onActiveTabChange(tab, options)
    this.renderTabs()
  }

  switchToIndex(index: number): void {
    const tab = this.tabs[index]
    if (tab) this.switchTab(tab.id, this.userSwitchOptions())
  }

  switchRelativeTab(delta: number): void {
    if (this.tabs.length === 0 || !this.activeId) return
    const currentIdx = this.tabs.findIndex((t) => t.id === this.activeId)
    if (currentIdx < 0) return
    const nextIdx = (currentIdx + delta + this.tabs.length) % this.tabs.length
    this.switchTab(this.tabs[nextIdx]!.id, this.userSwitchOptions())
  }

  closeTab(id: string): boolean {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return false

    if (this.isTabDirty(tab)) {
      if (
        !confirm(
          `「${tab.fileName}」に未保存の変更があります。\n保存せずに閉じると変更が失われます。\n\nタブを閉じますか？`,
        )
      ) {
        return false
      }
    }

    if (this.activeId === id) {
      this.onBeforeTabLeave?.()
      this.saveCurrentState()
    }

    const idx = this.tabs.findIndex((t) => t.id === id)
    this.tabs.splice(idx, 1)
    this.onTabClosed?.(id)
    this.externalChangeTabIds.delete(id)
    this.clearBindingsToTab(id)

    if (this.activeId === id) {
      if (this.tabs.length === 0) {
        this.addTab({ fileName: '未保存', activate: true })
      } else {
        const next = this.tabs[Math.min(idx, this.tabs.length - 1)]!
        this.activeId = next.id
        this.editor.setState(next.editorState)
        this.onActiveTabChange(next)
      }
    }

    this.renderTabs()
    return true
  }

  /** 編集後にタブ表示を更新 */
  notifyContentChanged(): void {
    this.renderTabs()
  }

  /** 保存完了後にスナップショットを更新 */
  markTabSaved(): void {
    const tab = this.activeTab
    if (!tab) return
    tab.savedContent = this.editor.getValue()
    tab.editorState = this.editor.getState()
    tab.docSettings.resetDirty()
    this.renderTabs()
  }

  updateActiveTab(): void {
    this.saveCurrentState()
    this.renderTabs()
  }

  setActiveFileName(name: string): void {
    const tab = this.activeTab
    if (!tab) return
    tab.fileName = name
    this.renderTabs()
  }

  findByFileName(name: string): EditorTab | undefined {
    return this.tabs.find((t) => t.fileName === name)
  }

  /** 閉じたタブへのリンクを他タブから除去 */
  clearBindingsToTab(closedTabId: string): void {
    for (const tab of this.tabs) {
      for (const [path, tabId] of Object.entries(tab.includeBindings)) {
        if (tabId === closedTabId) delete tab.includeBindings[path]
      }
    }
  }

  getOtherTabs(excludeId: string): EditorTab[] {
    return this.tabs.filter((t) => t.id !== excludeId)
  }

  getTabContent(tab: EditorTab): string {
    if (tab.id === this.activeId) {
      return this.editor.getValue()
    }
    return tab.editorState.doc.toString()
  }

  buildSession(): WorkspaceSession {
    this.saveCurrentState()
    const tabs = this.tabs.map((tab) => ({
      id: tab.id,
      fileName: tab.fileName,
      content: this.getTabContent(tab),
      savedContent: tab.savedContent,
      encoding: tab.docSettings.encoding,
      newline: tab.docSettings.newline,
      includeBindings: { ...tab.includeBindings },
      branchAssumptions: { ...(tab.branchAssumptions ?? {}) },
    }))
    return {
      version: 1,
      activeTabId: this.activeId ?? tabs[0]!.id,
      tabs,
      savedAt: Date.now(),
    }
  }

  restoreFromSession(session: WorkspaceSession): boolean {
    if (session.tabs.length === 0) return false

    this.tabs = []
    this.activeId = null
    syncNextTabIdFromExisting(session.tabs.map((t) => t.id))

    for (const saved of session.tabs.slice(0, MAX_TABS)) {
      const docSettings = new DocumentSettings()
      docSettings.encoding = saved.encoding
      docSettings.newline = saved.newline
      docSettings.loadFromText(saved.content, saved.encoding, saved.newline)

      const editorState = this.editor.createState(saved.content)
      this.tabs.push({
        id: saved.id,
        fileName: saved.fileName,
        docSettings,
        fileHandle: null,
        editorState,
        savedContent: saved.savedContent,
        includeBindings: migrateIncludeBindings(saved.content, { ...saved.includeBindings }),
        branchAssumptions: { ...(saved.branchAssumptions ?? {}) },
      })
    }

    const activeId = this.tabs.some((t) => t.id === session.activeTabId)
      ? session.activeTabId
      : this.tabs[0]!.id
    this.activeId = activeId
    const activeTab = this.tabs.find((t) => t.id === activeId)!
    this.editor.setState(activeTab.editorState)
    this.onActiveTabChange(activeTab)
    this.renderTabs()
    return true
  }
}
