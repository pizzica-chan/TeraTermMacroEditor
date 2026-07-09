import type { EditorState } from '@codemirror/state'
import type { EditorInstance } from '../editor/createEditor'
import { DocumentSettings } from '../text/documentSettings'

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
}

let nextTabId = 1

export function createTabId(): string {
  return `tab-${nextTabId++}`
}

export class TabManager {
  private tabs: EditorTab[] = []
  private activeId: string | null = null
  private editor: EditorInstance
  private tabListEl: HTMLElement
  private onActiveTabChange: (tab: EditorTab) => void

  constructor(
    editor: EditorInstance,
    tabListContainer: HTMLElement,
    onActiveTabChange: (tab: EditorTab) => void,
  ) {
    this.editor = editor
    this.tabListEl = tabListContainer
    this.onActiveTabChange = onActiveTabChange
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

  private renderTabs(): void {
    this.tabListEl.innerHTML = ''
    for (const tab of this.tabs) {
      const el = document.createElement('div')
      el.className = `tab-item${tab.id === this.activeId ? ' active' : ''}`
      el.dataset.id = tab.id
      el.title = tab.fileName

      const title = document.createElement('span')
      title.className = 'tab-title'
      title.textContent = (this.isTabDirty(tab) ? '• ' : '') + tab.fileName

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
      el.addEventListener('click', () => this.switchTab(tab.id))
      this.tabListEl.appendChild(el)
    }
  }

  addTab(options: {
    fileName?: string
    editorState?: EditorState
    docSettings?: DocumentSettings
    fileHandle?: FileSystemFileHandle | null
    activate?: boolean
  }): EditorTab | null {
    if (!this.canAddTab()) {
      alert(`タブは最大 ${MAX_TABS} 個まで開けます。`)
      return null
    }

    this.saveCurrentState()

    const editorState = options.editorState ?? this.editor.createState('')
    const tab: EditorTab = {
      id: createTabId(),
      fileName: options.fileName ?? '未保存',
      docSettings: options.docSettings ?? new DocumentSettings(),
      fileHandle: options.fileHandle ?? null,
      editorState,
      savedContent: editorState.doc.toString(),
      includeBindings: {},
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

  switchTab(id: string): void {
    if (this.activeId === id) return
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return

    this.saveCurrentState()
    this.activeId = id
    this.editor.setState(tab.editorState)
    this.editor.focus()
    this.onActiveTabChange(tab)
    this.renderTabs()
  }

  closeTab(id: string): boolean {
    if (this.activeId === id) {
      this.saveCurrentState()
    }

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

    const idx = this.tabs.findIndex((t) => t.id === id)
    this.tabs.splice(idx, 1)
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
}
