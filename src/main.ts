import './style.css'
import { createEditor, SAMPLE_MACRO } from './editor/createEditor'
import { createSidePanel } from './ui/sidePanel'
import {
  createToolbar,
  setThemeButton,
  setEncodingSelect,
  setNewlineSelect,
  setStatusMessage,
  setDryRunToolbarState,
} from './ui/toolbar'
import { TabManager, type EditorTab } from './ui/tabManager'
import { findIncludeRefs } from './ttl/includeRefs'
import { createIncludePanel } from './ui/includePanel'
import { clearAnalysisCache } from './ttl/analysisContext'
import { variableAssumptionKey } from './ttl/variableAssumptions'
import { flushrecvWarningIgnoreKey } from './ttl/flushrecvWarningIgnores'
import { consecutiveSendWarningIgnoreKey } from './ttl/consecutiveSendWarningIgnores'
import type { TextEncoding, NewlineType } from './text/types'
import { ENCODING_LABELS, NEWLINE_LABELS } from './text/types'
import { loadAppSettings, saveAppSettings } from './storage/appSettings'
import { showAppOptionsDialog } from './ui/appSettingsDialog'
import { setUnresolvedValueDisplay } from './ttl/unresolvedDisplay'
import { loadWorkspaceSession, saveWorkspaceSession } from './storage/sessionState'
import { showGotoLineDialog } from './ui/gotoLineDialog'
import { setupSidePanelResize } from './ui/sidePanelResize'
import { createBrowserDialogAdapter, cancelActiveTtlDialog } from './ui/ttlDialog'
import { createFileExternalWatcher, bytesFingerprint } from './ui/fileExternalWatch'
import { createAnalysisCoordinator } from './app/analysisCoordinator'
import { createDryRunController } from './app/dryRunController'
import { createWorkspaceFileService, readFileAsBytes } from './app/workspaceFileService'

const appSettings = loadAppSettings()
let isDark = appSettings.isDark
let flowchartShowDetailedWaits = appSettings.flowchartShowDetailedWaits
let flowchartShowAssignments = appSettings.flowchartShowAssignments
let checkFlushrecvBeforeSend = appSettings.checkFlushrecvBeforeSend
let checkConsecutiveSend = appSettings.checkConsecutiveSend
let unresolvedValueDisplay = appSettings.unresolvedValueDisplay
setUnresolvedValueDisplay(unresolvedValueDisplay)

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header id="toolbar"></header>
  <div class="tab-bar">
    <div class="tab-list" id="tab-list"></div>
    <button id="tab-add" class="tab-add-btn" title="新しいタブ">+</button>
  </div>
  <main class="main-layout">
    <section class="editor-pane">
      <div id="file-external-banner" class="file-external-banner" hidden>
        <span class="file-external-banner-message"></span>
        <div class="file-external-banner-actions">
          <button type="button" class="file-external-banner-btn" data-action="dismiss"></button>
          <button type="button" class="file-external-banner-btn primary" data-action="reload">再読み込み</button>
        </div>
      </div>
      <div id="editor"></div>
    </section>
    <div class="pane-resizer" id="pane-resizer" title="サイドパネル幅を変更"></div>
    <aside class="side-pane" id="side-panel"></aside>
  </main>
  <footer class="status-bar">
    <span id="status-position">Ln 1, Col 1</span>
    <span id="status-encoding"></span>
    <span id="status-lang">Tera Term Macro (TTL)</span>
  </footer>
`

const editor = createEditor(document.querySelector('#editor')!, '')
const sidePanel = createSidePanel(document.querySelector('#side-panel')!, {
  dark: isDark,
  showDetailedWaits: flowchartShowDetailedWaits,
  showAssignments: flowchartShowAssignments,
  checkFlushrecvBeforeSend,
  checkConsecutiveSend,
})
const includePanel = createIncludePanel(sidePanel.includeMount)
sidePanel.onGotoLine((line) => editor.gotoLine(line))

setupSidePanelResize(
  document.querySelector('#pane-resizer')!,
  document.querySelector('#side-panel')!,
  appSettings.sidePanelWidth,
)

function applyTheme(dark: boolean) {
  isDark = dark
  editor.setTheme(dark)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  sidePanel.setFlowchartTheme(dark)
  setThemeButton(dark)
  saveAppSettings({ isDark: dark })
}

applyTheme(isDark)

function getActiveTab(): EditorTab {
  const tab = tabManager.activeTab
  if (!tab) throw new Error('No active tab')
  return tab
}

function updateStatusBar(tab: EditorTab): void {
  setStatusMessage(`${ENCODING_LABELS[tab.docSettings.encoding]} / ${NEWLINE_LABELS[tab.docSettings.newline]}`)
}

function buildTabNameMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const t of tabManager.allTabs) map[t.id] = t.fileName
  return map
}

function refreshIncludeDecorations(refs: ReturnType<typeof findIncludeRefs>, tab: EditorTab) {
  editor.setIncludeDecorations({
    refs,
    bindings: tab.includeBindings,
    tabNames: buildTabNameMap(),
  })
}

function refreshIncludePanel(text?: string, options?: { readOnly?: boolean }) {
  const tab = tabManager.activeTab
  if (!tab) return

  const source = text ?? editor.getValue()
  const refs = findIncludeRefs(source)
  const otherTabs = tabManager.getOtherTabs(tab.id)

  includePanel.update(refs, tab, otherTabs, {
    readOnly: options?.readOnly ?? false,
    onBindingChange(path, tabId) {
      if (tabId) tab.includeBindings[path] = tabId
      else delete tab.includeBindings[path]
      editor.notifyIncludeGraphChanged()
      analysis.runAnalysisNow(editor.getValue())
      schedulePersistWorkspaceSession()
    },
    onGotoLine(line) {
      editor.gotoLine(line)
    },
    onOpenLinkedTab(tabId) {
      dryRun.stopIfRunning()
      tabManager.switchTab(tabId)
    },
  })

  refreshIncludeDecorations(refs, tab)
}

function syncUiFromTab(tab: EditorTab, options?: { keepDryRun?: boolean }): void {
  if (!options?.keepDryRun) dryRun.stopIfRunning()
  setEncodingSelect(tab.docSettings.encoding)
  setNewlineSelect(tab.docSettings.newline)
  updateStatusBar(tab)
  clearAnalysisCache()
  analysis.runAnalysisNow(editor.getValue())
  updateCursorPosition()
  schedulePersistWorkspaceSession()
  if (options?.keepDryRun) dryRun.refreshDryRunHighlight()
  fileWatcher.refreshBanner()
}

let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null

function persistWorkspaceSession(): void {
  tabManager.flushEditorState()
  saveWorkspaceSession(tabManager.buildSession())
}

function schedulePersistWorkspaceSession(): void {
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer)
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null
    persistWorkspaceSession()
  }, 500)
}

const includeHost = {
  get allTabs() {
    return tabManager.allTabs
  },
  getTabContent(tab: EditorTab) {
    return tabManager.getTabContent(tab)
  },
}

// analysis / dryRun は相互参照するため、先にプレースホルダ相当の遅延束縛で生成する
const analysis = createAnalysisCoordinator({
  includeHost,
  getActiveTab: () => tabManager.activeTab,
  getEditorValue: () => editor.getValue(),
  isEditorValue: (text) => editor.getValue() === text,
  notifyIncludeGraphChanged: () => editor.notifyIncludeGraphChanged(),
  setBranchAssumptionDecorations: (items) => editor.setBranchAssumptionDecorations(items),
  setVariableAssumptionDecorations: (items) => editor.setVariableAssumptionDecorations(items),
  notifyAnalysisCacheChanged: () => editor.notifyAnalysisCacheChanged(),
  updateSidePanel: (payload) => sidePanel.update(payload),
  updateFlowchart: (model) => sidePanel.updateFlowchart(model),
  refreshIncludePanel: (text, options) => refreshIncludePanel(text, options),
  isDryRunInProgress: () => dryRun.isDryRunInProgress(),
  schedulePersistWorkspaceSession,
  flowchartShowDetailedWaits: () => flowchartShowDetailedWaits,
  flowchartShowAssignments: () => flowchartShowAssignments,
  checkFlushrecvBeforeSend: () => checkFlushrecvBeforeSend,
  checkConsecutiveSend: () => checkConsecutiveSend,
})

const dryRunDialogAdapter = createBrowserDialogAdapter()

const dryRun = createDryRunController({
  allTabs: () => tabManager.allTabs,
  getActiveTab: () => tabManager.activeTab,
  getEditorValue: () => editor.getValue(),
  switchTab: (tabId, options) => tabManager.switchTab(tabId, options),
  gotoLine: (line) => editor.gotoLine(line),
  setExecutionLine: (line, waiting) => editor.setExecutionLine(line, waiting),
  clearExecutionLine: () => editor.clearExecutionLine(),
  setDryRunLocked: (locked) => editor.setDryRunLocked(locked),
  setDryRunToolbarState,
  showDryRunTab: () => sidePanel.showTab('dryrun'),
  updateDryRun: (state) => sidePanel.updateDryRun(state),
  setStatusMessage,
  cancelActiveDialog: cancelActiveTtlDialog,
  syncTabIncludeBindings: (tab, source) => analysis.syncTabIncludeBindings(tab, source),
  collectAnalysisLimitations: (tab, source) => analysis.collectAnalysisLimitations(tab, source),
  snapshotDryRunContext: (originTab) => analysis.snapshotDryRunContext(originTab),
  createIncludeResolver: (tab, snapshot) => analysis.createIncludeResolver(tab, snapshot),
  runAnalysisNow: (text) => analysis.runAnalysisNow(text),
  updateCursorPosition,
  dialogAdapter: dryRunDialogAdapter,
})

const tabManager = new TabManager(
  editor,
  document.querySelector('#tab-list')!,
  syncUiFromTab,
  () => {
    editor.clearExecutionLine()
  },
)
tabManager.setKeepDryRunOnUserSwitch(() => {
  dryRun.stopIfRunning()
  return false
})
tabManager.setOnTabClosed((closedTabId) => {
  dryRun.onTabClosed(closedTabId)
  fileWatcher.clearTab(closedTabId)
  schedulePersistWorkspaceSession()
})

const fileExternalBannerEl = document.querySelector<HTMLDivElement>('#file-external-banner')!
const fileExternalBannerMessageEl = fileExternalBannerEl.querySelector<HTMLSpanElement>('.file-external-banner-message')!
const fileExternalBannerDismissBtn = fileExternalBannerEl.querySelector<HTMLButtonElement>('[data-action="dismiss"]')!
const fileExternalBannerReloadBtn = fileExternalBannerEl.querySelector<HTMLButtonElement>('[data-action="reload"]')!

function reloadTabFromDisk(tab: EditorTab, bytes: Uint8Array): void {
  dryRun.stopIfRunning()
  const loaded = tab.docSettings.loadFromBytes(bytes)
  if (tab.id === tabManager.activeTab?.id) {
    editor.setValue(loaded.text)
    tab.editorState = editor.getState()
    setEncodingSelect(tab.docSettings.encoding)
    setNewlineSelect(tab.docSettings.newline)
    updateStatusBar(tab)
    clearAnalysisCache()
    analysis.runAnalysisNow(loaded.text)
    updateCursorPosition()
  } else {
    tab.editorState = editor.createState(loaded.text)
  }
  tab.savedContent = loaded.text
  tabManager.notifyContentChanged()
  schedulePersistWorkspaceSession()
}

const fileWatchDebug = new URLSearchParams(location.search).has('fileWatchDebug')

function tabBaselineKey(tab: EditorTab): string {
  const { bytes } = tab.docSettings.prepareSave(tab.savedContent)
  return bytesFingerprint(bytes)
}

const fileWatcher = createFileExternalWatcher({
  getTabs: () => tabManager.allTabs,
  getActiveTabId: () => tabManager.activeTab?.id ?? null,
  isTabDirty: (tab) => tabManager.isTabDirty(tab),
  getTabBaselineKey: tabBaselineKey,
  readFileAsBytes,
  onReloadTab: reloadTabFromDisk,
  onPendingChange: (tabId, pending) => tabManager.setExternalChangePending(tabId, pending),
  onBannerUpdate(info) {
    if (!info) {
      fileExternalBannerEl.hidden = true
      return
    }
    fileExternalBannerEl.hidden = false
    fileExternalBannerEl.dataset.tabId = info.tabId
    if (info.dirty) {
      fileExternalBannerMessageEl.textContent = `「${info.fileName}」が他のプログラムで更新されました。未保存の変更があります。`
      fileExternalBannerDismissBtn.textContent = '編集を続ける'
    } else {
      fileExternalBannerMessageEl.textContent = `「${info.fileName}」が他のプログラムで更新されました。`
      fileExternalBannerDismissBtn.textContent = '後で'
    }
  },
}, { debug: fileWatchDebug })

fileExternalBannerReloadBtn.addEventListener('click', () => {
  const tabId = fileExternalBannerEl.dataset.tabId
  if (!tabId) return
  const tab = tabManager.allTabs.find((t) => t.id === tabId)
  if (!tab) return
  if (tabManager.isTabDirty(tab)) {
    if (
      !confirm(
        `「${tab.fileName}」を再読み込みすると、エディタ内の未保存の変更は失われます。\n\n再読み込みしますか？`,
      )
    ) {
      return
    }
  }
  void fileWatcher.reloadTab(tabId).then((ok) => {
    if (!ok) alert('ファイルの再読み込みに失敗しました。')
  })
})

fileExternalBannerDismissBtn.addEventListener('click', () => {
  const tabId = fileExternalBannerEl.dataset.tabId
  if (tabId) fileWatcher.dismissBanner(tabId)
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleFileWatchPoll()
})

let fileWatchFocusPollTimer: ReturnType<typeof setTimeout> | null = null
function scheduleFileWatchPoll(): void {
  if (fileWatchFocusPollTimer) clearTimeout(fileWatchFocusPollTimer)
  fileWatchFocusPollTimer = setTimeout(() => {
    fileWatchFocusPollTimer = null
    void fileWatcher.pollNow()
  }, 200)
}

window.addEventListener('focus', () => {
  scheduleFileWatchPoll()
})

function updateCursorPosition() {
  const pos = editor.view.state.selection.main.head
  const line = editor.view.state.doc.lineAt(pos)
  const col = pos - line.from + 1
  const el = document.querySelector('#status-position')
  if (el) el.textContent = `Ln ${line.number}, Col ${col}`
  if (!dryRun.isDryRunInProgress()) {
    const tab = tabManager.activeTab
    sidePanel.setFlowchartActiveLocation(tab ? `${tab.id}:L${line.number}` : undefined)
  }
}

editor.onChange((text) => {
  if (!dryRun.isDryRunInProgress()) {
    tabManager.activeTab?.docSettings.markDirty()
  }
  tabManager.notifyContentChanged()
  const tab = tabManager.activeTab
  if (tab && tabManager.hasExternalChangePending(tab)) {
    fileWatcher.refreshBanner()
  }
  analysis.runAnalysis(text)
  updateCursorPosition()
  schedulePersistWorkspaceSession()
})

editor.view.dom.addEventListener('keyup', updateCursorPosition)
editor.view.dom.addEventListener('click', updateCursorPosition)

const files = createWorkspaceFileService({
  getActiveTab,
  allTabs: () => tabManager.allTabs,
  canAddTab: () => tabManager.canAddTab(),
  addTab: (options) => tabManager.addTab(options),
  switchTab: (tabId, options) => tabManager.switchTab(tabId, options),
  getEditorValue: () => editor.getValue(),
  setEditorValue: (text) => editor.setValue(text),
  getEditorState: () => editor.getState(),
  createEditorState: (text) => editor.createState(text),
  markTabSaved: () => tabManager.markTabSaved(),
  setActiveFileName: (name) => tabManager.setActiveFileName(name),
  notifyContentChanged: () => tabManager.notifyContentChanged(),
  hasExternalChangePending: (tab) => tabManager.hasExternalChangePending(tab),
  dryRunKeepOptions: () => dryRun.dryRunKeepOptions(),
  stopDryRunIfRunning: () => dryRun.stopIfRunning(),
  syncUiFromTab,
  runAnalysisNow: (text) => analysis.runAnalysisNow(text),
  updateStatusBar,
  setEncodingSelect,
  setNewlineSelect,
  persistWorkspaceSession,
  schedulePersistWorkspaceSession,
  markDiskSynced: (tabId, bytes, file) => fileWatcher.markDiskSynced(tabId, bytes, file),
  setSaving: (tabId, saving) => fileWatcher.setSaving(tabId, saving),
  pollFileWatcherNow: () => {
    void fileWatcher.pollNow()
  },
})

function handleThemeToggle() {
  applyTheme(!isDark)
}

function handleOpenOptions() {
  showAppOptionsDialog({
    values: {
      unresolvedValueDisplay,
      checkFlushrecvBeforeSend,
      checkConsecutiveSend,
      flowchartShowDetailedWaits,
      flowchartShowAssignments,
    },
    onChange(partial) {
      if (partial.unresolvedValueDisplay !== undefined) {
        unresolvedValueDisplay = partial.unresolvedValueDisplay
        setUnresolvedValueDisplay(unresolvedValueDisplay)
        saveAppSettings({ unresolvedValueDisplay })
        sidePanel.refresh()
      }
      if (partial.checkFlushrecvBeforeSend !== undefined) {
        checkFlushrecvBeforeSend = partial.checkFlushrecvBeforeSend
        saveAppSettings({ checkFlushrecvBeforeSend })
        analysis.runAnalysisNow(editor.getValue())
      }
      if (partial.checkConsecutiveSend !== undefined) {
        checkConsecutiveSend = partial.checkConsecutiveSend
        saveAppSettings({ checkConsecutiveSend })
        analysis.runAnalysisNow(editor.getValue())
      }
      if (partial.flowchartShowDetailedWaits !== undefined) {
        flowchartShowDetailedWaits = partial.flowchartShowDetailedWaits
        saveAppSettings({ flowchartShowDetailedWaits })
        sidePanel.syncViewOptions({ showDetailedWaits: flowchartShowDetailedWaits })
        sidePanel.updateFlowchart(analysis.buildFlowchartForActiveTab(editor.getValue()))
      }
      if (partial.flowchartShowAssignments !== undefined) {
        flowchartShowAssignments = partial.flowchartShowAssignments
        saveAppSettings({ flowchartShowAssignments })
        sidePanel.syncViewOptions({ showAssignments: flowchartShowAssignments })
        sidePanel.updateFlowchart(analysis.buildFlowchartForActiveTab(editor.getValue()))
      }
    },
  })
}

function handleGotoLine() {
  const pos = editor.view.state.selection.main.head
  const currentLine = editor.view.state.doc.lineAt(pos).number
  const maxLine = editor.view.state.doc.lines
  showGotoLineDialog({
    currentLine,
    maxLine,
    onSubmit: (line) => editor.gotoLine(line),
  })
}

function handleCloseTab() {
  const tab = tabManager.activeTab
  if (tab && tabManager.closeTab(tab.id)) {
    schedulePersistWorkspaceSession()
  }
}

createToolbar(document.querySelector('#toolbar')!, editor, {
  onNew: () => files.handleNewTab(),
  onOpen: () => {
    void files.handleOpen()
  },
  onSave: () => {
    void files.handleSave()
  },
  onThemeToggle: handleThemeToggle,
  onOpenOptions: handleOpenOptions,
  onEncodingChange: (encoding: TextEncoding) => files.handleEncodingChange(encoding),
  onNewlineChange: (newline: NewlineType) => files.handleNewlineChange(newline),
  onCloseTab: handleCloseTab,
  onGotoLine: handleGotoLine,
  onSwitchTab: (index) => tabManager.switchToIndex(index),
  onSwitchTabRelative: (delta) => tabManager.switchRelativeTab(delta),
  onDryRunStart: () => {
    void dryRun.startDryRun()
  },
  onDryRunStop: () => dryRun.stopDryRun(),
})

sidePanel.onGotoDryRunLocation(dryRun.gotoDryRunLocation)
sidePanel.onGotoSendLocation(dryRun.gotoSendLocation)
sidePanel.onGotoFlowchartLocation(dryRun.gotoFlowchartLocation)
sidePanel.onFlowchartDetailedWaitsChange((show) => {
  flowchartShowDetailedWaits = show
  saveAppSettings({ flowchartShowDetailedWaits: show })
  sidePanel.updateFlowchart(analysis.buildFlowchartForActiveTab(editor.getValue()))
})
sidePanel.onFlowchartAssignmentsChange((show) => {
  flowchartShowAssignments = show
  saveAppSettings({ flowchartShowAssignments: show })
  sidePanel.updateFlowchart(analysis.buildFlowchartForActiveTab(editor.getValue()))
})
sidePanel.onFlushrecvWarningIgnoreChange((line, ignored) => {
  const tab = tabManager.activeTab
  if (!tab) return
  const next = { ...(tab.flushrecvWarningIgnores ?? {}) }
  const key = flushrecvWarningIgnoreKey(line)
  if (ignored) next[key] = true
  else delete next[key]
  tab.flushrecvWarningIgnores = next
  schedulePersistWorkspaceSession()
  analysis.runAnalysisNow(editor.getValue())
})
sidePanel.onConsecutiveSendWarningIgnoreChange((line, ignored) => {
  const tab = tabManager.activeTab
  if (!tab) return
  const next = { ...(tab.consecutiveSendWarningIgnores ?? {}) }
  const key = consecutiveSendWarningIgnoreKey(line)
  if (ignored) next[key] = true
  else delete next[key]
  tab.consecutiveSendWarningIgnores = next
  schedulePersistWorkspaceSession()
  analysis.runAnalysisNow(editor.getValue())
})

sidePanel.onClearDryRun(() => {
  dryRun.clearDryRunPanel()
})

sidePanel.onBranchAssumptionChange((line, value) => {
  const tab = tabManager.activeTab
  if (!tab) return
  const next = { ...(tab.branchAssumptions ?? {}) }
  const key = String(line)
  if (value === null) delete next[key]
  else next[key] = value
  tab.branchAssumptions = next
  schedulePersistWorkspaceSession()
  analysis.runAnalysisNow(editor.getValue())
})

sidePanel.onVariableAssumptionChange((line, name, value) => {
  const tab = tabManager.activeTab
  if (!tab) return
  const next = { ...(tab.variableAssumptions ?? {}) }
  const key = variableAssumptionKey(line, name)
  if (value === null) delete next[key]
  else next[key] = value
  tab.variableAssumptions = next
  schedulePersistWorkspaceSession()
  analysis.runAnalysisNow(editor.getValue())
})

document.querySelector('#tab-add')!.addEventListener('click', () => files.handleNewTab())

files.setupFileDrop(document.querySelector('#app')!)

function initWorkspace() {
  const session = loadWorkspaceSession()
  if (session && tabManager.restoreFromSession(session)) {
    const tab = tabManager.activeTab
    if (tab) syncUiFromTab(tab)
    return
  }

  const initialTab = tabManager.addTab({
    fileName: 'サンプル.ttl',
    editorState: editor.createState(SAMPLE_MACRO),
    activate: true,
  })
  if (initialTab) syncUiFromTab(initialTab)
  persistWorkspaceSession()
}

initWorkspace()

window.addEventListener('beforeunload', (e) => {
  persistWorkspaceSession()
  if (tabManager.hasUnsavedChanges()) {
    e.preventDefault()
    e.returnValue = ''
  }
})
