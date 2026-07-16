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
import { TabManager, MAX_TABS, type EditorTab } from './ui/tabManager'
import { analyzeTTL, collectIncludeCrossTabVarContext, type IncludeResolver, type VariableInfo } from './ttl/analyzer'
import {
  findIncludeRefs,
  includeDynamicBindingKey,
  isIncludeRefLinked,
  migrateIncludeBindings,
  normalizeIncludePath,
  resolveIncludeBindingTabId,
  resolveIncludePathBindingKey,
  resolveLoopIncludeBindingKey,
  type IncludeResolveContext,
} from './ttl/includeRefs'
import { createIncludePanel } from './ui/includePanel'
import { setIncludeResolver, setIncludeCrossTabContext, setAnalysisCache, clearAnalysisCache } from './ttl/analysisContext'
import { evaluateTTL } from './ttl/evaluator'
import {
  collectIndeterminateIfBranches,
  branchAssumptionsFromRecord,
  pruneBranchAssumptions,
} from './ttl/branchAssumptions'
import {
  formatAnalysisLimitationWarning,
  hasAnalysisLimitations,
  type AnalysisLimitations,
} from './ttl/analysisLimitations'
import { DocumentSettings } from './text/documentSettings'
import type { TextEncoding, NewlineType } from './text/types'
import { ENCODING_LABELS, NEWLINE_LABELS } from './text/types'
import { createDefaultDocumentSettings, loadAppSettings, saveAppSettings } from './storage/appSettings'
import { loadWorkspaceSession, saveWorkspaceSession } from './storage/sessionState'
import { showGotoLineDialog } from './ui/gotoLineDialog'
import { setupSidePanelResize } from './ui/sidePanelResize'
import { DryRunSession, isDryRunMainLocation, type DryRunState } from './ttl/dryRun'
import { createBrowserDialogAdapter, cancelActiveTtlDialog } from './ui/ttlDialog'
import { createFileExternalWatcher } from './ui/fileExternalWatch'
import { buildFlowchart } from './ttl/flowchart'

const appSettings = loadAppSettings()
let isDark = appSettings.isDark
let flowchartShowDetailedWaits = appSettings.flowchartShowDetailedWaits
let flowchartShowAssignments = appSettings.flowchartShowAssignments

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

function syncUiFromTab(tab: EditorTab, options?: { keepDryRun?: boolean }): void {
  if (!options?.keepDryRun && (dryRunActive || dryRunRunPromise !== null)) stopDryRun()
  setEncodingSelect(tab.docSettings.encoding)
  setNewlineSelect(tab.docSettings.newline)
  updateStatusBar(tab)
  clearAnalysisCache()
  runAnalysisNow(editor.getValue())
  updateCursorPosition()
  schedulePersistWorkspaceSession()
  if (options?.keepDryRun) refreshDryRunHighlight()
  fileWatcher.refreshBanner()
}

function updateStatusBar(tab: EditorTab): void {
  setStatusMessage(`${ENCODING_LABELS[tab.docSettings.encoding]} / ${NEWLINE_LABELS[tab.docSettings.newline]}`)
}

function resolveLinkedTabContent(linkedTabId: string | undefined): string | null {
  if (!linkedTabId) return null
  const linkedTab = tabManager.allTabs.find((t) => t.id === linkedTabId)
  if (!linkedTab) return null
  return tabManager.getTabContent(linkedTab)
}

interface DryRunSnapshot {
  contents: Map<string, string>
  bindings: Map<string, Record<string, string>>
}

/** ドライラン起点からリンク先タブの内容・バインディングを起動時点で固定する */
function snapshotDryRunContext(originTab: EditorTab): DryRunSnapshot {
  const contents = new Map<string, string>()
  const bindings = new Map<string, Record<string, string>>()
  const visit = (tab: EditorTab) => {
    if (!contents.has(tab.id)) {
      contents.set(tab.id, tabManager.getTabContent(tab))
      bindings.set(tab.id, { ...tab.includeBindings })
    }
    for (const tabId of Object.values(bindings.get(tab.id)!)) {
      const linked = tabManager.allTabs.find((t) => t.id === tabId)
      if (linked) visit(linked)
    }
  }
  visit(originTab)
  return { contents, bindings }
}

function createIncludeResolver(tab: EditorTab, dryRunSnapshot?: DryRunSnapshot): IncludeResolver {
  const readContent = (tabId: string): string | null => {
    if (dryRunSnapshot) return dryRunSnapshot.contents.get(tabId) ?? null
    return resolveLinkedTabContent(tabId)
  }

  const tabBindings = () => dryRunSnapshot?.bindings.get(tab.id) ?? tab.includeBindings

  const resolveTabId = (bindingKey: string, rawArg?: string, effectiveRaw?: string) =>
    resolveIncludeBindingTabId(tabBindings(), bindingKey, rawArg, effectiveRaw)

  const resolveByKey = (bindingKey: string, rawArg?: string, effectiveRaw?: string) => {
    const tabId = resolveTabId(bindingKey, rawArg, effectiveRaw)
    return tabId ? readContent(tabId) : null
  }

  return {
    resolve(path: string) {
      return resolveByKey(normalizeIncludePath(path))
    },
    resolveDynamic(rawArg: string, context?: IncludeResolveContext) {
      const bindingKey =
        context?.loopValue !== undefined && context.line !== undefined
          ? resolveLoopIncludeBindingKey(context.line, context.loopValue, context.effectiveRaw)
          : includeDynamicBindingKey(rawArg)
      return resolveByKey(bindingKey, rawArg, context?.effectiveRaw)
    },
    getLinkedTabId(bindingKey: string, rawArg?: string, effectiveRaw?: string) {
      return resolveTabId(bindingKey, rawArg, effectiveRaw)
    },
    resolverForLinkedTab(tabId: string) {
      if (tabId === tab.id) return null
      const linkedTab = tabManager.allTabs.find((t) => t.id === tabId)
      return linkedTab ? createIncludeResolver(linkedTab, dryRunSnapshot) : null
    },
    getBranchAssumptions(tabId: string) {
      // 分岐仮定は静的表示専用。ドライラン用スナップショットには混入させない。
      if (dryRunSnapshot) return undefined
      const linkedTab = tabManager.allTabs.find((t) => t.id === tabId)
      return linkedTab
        ? branchAssumptionsFromRecord(linkedTab.branchAssumptions)
        : undefined
    },
  }
}

function collectAnalysisLimitations(
  originTab: EditorTab,
  originSource: string,
  originBranches?: ReturnType<typeof collectIndeterminateIfBranches>,
): AnalysisLimitations {
  const limitations: AnalysisLimitations = {
    unassumedBranches: [],
    unlinkedIncludes: [],
  }
  const visited = new Set<string>()
  const queue: Array<{ tab: EditorTab; source: string }> = [
    { tab: originTab, source: originSource },
  ]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current.tab.id)) continue
    visited.add(current.tab.id)

    const refs = findIncludeRefs(current.source)
    for (const ref of refs) {
      if (!isIncludeRefLinked(ref, current.tab.includeBindings)) {
        limitations.unlinkedIncludes.push({
          sourceName: current.tab.fileName,
          line: ref.line,
          raw: ref.raw,
        })
      }
    }

    const branches =
      current.tab.id === originTab.id && originBranches
        ? originBranches
        : collectIndeterminateIfBranches(
            current.source,
            evaluateTTL(current.source, {
              includeResolver: createIncludeResolver(current.tab),
            }).beforeLine,
          )
    for (const branch of branches) {
      if (current.tab.branchAssumptions?.[String(branch.line)] === undefined) {
        limitations.unassumedBranches.push({
          sourceName: current.tab.fileName,
          line: branch.line,
          conditionText: branch.conditionText,
        })
      }
    }

    for (const linkedTabId of new Set(Object.values(current.tab.includeBindings))) {
      const linkedTab = tabManager.allTabs.find((tab) => tab.id === linkedTabId)
      if (!linkedTab || visited.has(linkedTab.id)) continue
      queue.push({
        tab: linkedTab,
        source: tabManager.getTabContent(linkedTab),
      })
    }
  }

  return limitations
}

function syncTabIncludeBindings(tab: EditorTab, source: string): void {
  const migrated = migrateIncludeBindings(source, tab.includeBindings)
  if (migrated !== tab.includeBindings) {
    tab.includeBindings = migrated
    editor.notifyIncludeGraphChanged()
    schedulePersistWorkspaceSession()
  }
}

function getIncludeCrossTabContext(tab: EditorTab): {
  externallyDeclared: Map<string, VariableInfo>
  externallyUsed: Set<string>
} {
  const externallyDeclared = new Map<string, VariableInfo>()
  const externallyUsed = new Set<string>()

  for (const parentTab of tabManager.allTabs) {
    if (parentTab.id === tab.id) continue
    const includesThis = Object.values(parentTab.includeBindings).includes(tab.id)
    if (!includesThis) continue

    const ctx = collectIncludeCrossTabVarContext(
      tabManager.getTabContent(parentTab),
      createIncludeResolver(parentTab),
      tab.id,
    )
    for (const [key, info] of ctx.externallyDeclared) {
      if (!externallyDeclared.has(key)) externallyDeclared.set(key, info)
    }
    for (const name of ctx.externallyUsed) externallyUsed.add(name)
  }

  return { externallyDeclared, externallyUsed }
}

let analysisTimer: ReturnType<typeof setTimeout> | null = null
const ANALYSIS_DEBOUNCE_MS = 250

function buildFlowchartForActiveTab(text: string) {
  const tab = tabManager.activeTab
  if (!tab) return null
  const resolver = createIncludeResolver(tab)
  return buildFlowchart(text, {
    sourceId: tab.id,
    sourceName: tab.fileName,
    includeResolver: resolver,
    getSourceName: (sourceId) =>
      tabManager.allTabs.find((candidate) => candidate.id === sourceId)?.fileName,
    showDetailedWaits: flowchartShowDetailedWaits,
    showAssignments: flowchartShowAssignments,
  })
}

function refreshFlowchart(): void {
  sidePanel.updateFlowchart(buildFlowchartForActiveTab(editor.getValue()))
}

function runAnalysisImmediate(text: string): void {
  const tab = tabManager.activeTab
  if (tab) syncTabIncludeBindings(tab, text)

  const resolver = tab ? createIncludeResolver(tab) : undefined
  const crossTab = tab ? getIncludeCrossTabContext(tab) : undefined
  setIncludeResolver(resolver)
  setIncludeCrossTabContext(crossTab)

  const result = analyzeTTL(text, {
    includeResolver: resolver,
    externallyUsedNames: crossTab?.externallyUsed,
    externallyDeclaredVars: crossTab?.externallyDeclared,
  })
  const evaluationForBranches = evaluateTTL(text, {
    includeResolver: resolver,
  })
  const indeterminateBranches = collectIndeterminateIfBranches(text, evaluationForBranches.beforeLine)

  if (tab) {
    const validLines = new Set(indeterminateBranches.map((b) => b.line))
    tab.branchAssumptions = pruneBranchAssumptions(tab.branchAssumptions ?? {}, validLines)
  }

  const branchAssumptions = tab ? branchAssumptionsFromRecord(tab.branchAssumptions) : new Map<number, boolean>()
  const evaluation =
    branchAssumptions.size > 0
      ? evaluateTTL(text, {
          includeResolver: resolver,
          branchAssumptions,
        })
      : evaluationForBranches

  if (editor.getValue() !== text) return

  const analysisLimitations = tab
    ? collectAnalysisLimitations(tab, text, indeterminateBranches)
    : { unassumedBranches: [], unlinkedIncludes: [] }
  editor.setBranchAssumptionDecorations(
    [...branchAssumptions].map(([line, value]) => ({ line, value })),
  )
  setAnalysisCache(text, result, evaluation)
  editor.notifyAnalysisCacheChanged()

  sidePanel.update({
    analysis: result,
    sendEntries: evaluation.sendEntries,
    indeterminateBranches,
    branchAssumptions: tab?.branchAssumptions ?? {},
    analysisLimitations,
  })
  sidePanel.updateFlowchart(buildFlowchartForActiveTab(text))
  refreshIncludePanel(text, { readOnly: isDryRunInProgress() })
}

function runAnalysis(text: string, immediate = false): void {
  if (immediate) {
    if (analysisTimer) {
      clearTimeout(analysisTimer)
      analysisTimer = null
    }
    runAnalysisImmediate(text)
    return
  }
  if (analysisTimer) clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => {
    analysisTimer = null
    runAnalysisImmediate(text)
  }, ANALYSIS_DEBOUNCE_MS)
}

function runAnalysisNow(text: string): void {
  runAnalysis(text, true)
}

function buildTabNameMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const t of tabManager.allTabs) map[t.id] = t.fileName
  return map
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
      runAnalysisNow(editor.getValue())
      schedulePersistWorkspaceSession()
    },
    onGotoLine(line) {
      editor.gotoLine(line)
    },
    onOpenLinkedTab(tabId) {
      if (dryRunActive || dryRunRunPromise !== null) stopDryRun()
      tabManager.switchTab(tabId)
    },
  })

  refreshIncludeDecorations(refs, tab)
}

function refreshIncludeDecorations(refs: ReturnType<typeof findIncludeRefs>, tab: EditorTab) {
  editor.setIncludeDecorations({
    refs,
    bindings: tab.includeBindings,
    tabNames: buildTabNameMap(),
  })
}

const tabManager = new TabManager(
  editor,
  document.querySelector('#tab-list')!,
  syncUiFromTab,
  () => {
    editor.clearExecutionLine()
  },
)
tabManager.setKeepDryRunOnUserSwitch(() => {
  if (dryRunActive || dryRunRunPromise !== null) stopDryRun()
  return false
})
tabManager.setOnTabClosed((closedTabId) => {
  const related = isDryRunRelatedTab(closedTabId)
  if (closedTabId === dryRunOriginTabId) dryRunOriginTabId = null
  if ((dryRunActive || dryRunRunPromise !== null) && related) stopDryRun()
  fileWatcher.clearTab(closedTabId)
  schedulePersistWorkspaceSession()
})

const fileExternalBannerEl = document.querySelector<HTMLDivElement>('#file-external-banner')!
const fileExternalBannerMessageEl = fileExternalBannerEl.querySelector<HTMLSpanElement>('.file-external-banner-message')!
const fileExternalBannerDismissBtn = fileExternalBannerEl.querySelector<HTMLButtonElement>('[data-action="dismiss"]')!
const fileExternalBannerReloadBtn = fileExternalBannerEl.querySelector<HTMLButtonElement>('[data-action="reload"]')!

function reloadTabFromDisk(tab: EditorTab, bytes: Uint8Array): void {
  if (dryRunActive || dryRunRunPromise !== null) stopDryRun()
  const loaded = tab.docSettings.loadFromBytes(bytes)
  if (tab.id === tabManager.activeTab?.id) {
    editor.setValue(loaded.text)
    tab.editorState = editor.getState()
    setEncodingSelect(tab.docSettings.encoding)
    setNewlineSelect(tab.docSettings.newline)
    updateStatusBar(tab)
    clearAnalysisCache()
    runAnalysisNow(loaded.text)
    updateCursorPosition()
  } else {
    tab.editorState = editor.createState(loaded.text)
  }
  tab.savedContent = loaded.text
  tabManager.notifyContentChanged()
  schedulePersistWorkspaceSession()
}

const fileWatcher = createFileExternalWatcher({
  getTabs: () => tabManager.allTabs,
  getActiveTabId: () => tabManager.activeTab?.id ?? null,
  isTabDirty: (tab) => tabManager.isTabDirty(tab),
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
})

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
  void fileWatcher.reloadTab(tabId)
})

fileExternalBannerDismissBtn.addEventListener('click', () => {
  const tabId = fileExternalBannerEl.dataset.tabId
  if (tabId) fileWatcher.dismissBanner(tabId)
})

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

editor.onChange((text) => {
  if (!isDryRunInProgress()) {
    tabManager.activeTab?.docSettings.markDirty()
  }
  tabManager.notifyContentChanged()
  runAnalysis(text)
  updateCursorPosition()
  schedulePersistWorkspaceSession()
})

function updateCursorPosition() {
  const pos = editor.view.state.selection.main.head
  const line = editor.view.state.doc.lineAt(pos)
  const col = pos - line.from + 1
  const statusEl = document.querySelector('#status-position')
  if (statusEl) statusEl.textContent = `Ln ${line.number}, Col ${col}`
  if (!isDryRunInProgress()) {
    const tab = tabManager.activeTab
    sidePanel.setFlowchartActiveLocation(tab ? `${tab.id}:L${line.number}` : undefined)
  }
}

editor.view.dom.addEventListener('keyup', updateCursorPosition)
editor.view.dom.addEventListener('click', updateCursorPosition)

function handleNewTab() {
  if (!tabManager.canAddTab()) {
    alert(`タブは最大 ${MAX_TABS} 個まで開けます。`)
    return
  }
  if (dryRunActive || dryRunRunPromise !== null) stopDryRun()
  tabManager.addTab({ fileName: '未保存', docSettings: createDefaultDocumentSettings(), activate: true })
}

function handleNew() {
  handleNewTab()
}

async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}

async function openFile(
  bytes: Uint8Array,
  fileName: string,
  fileHandle: FileSystemFileHandle | null,
  options?: { ifAlreadyOpen?: 'switch' | 'skip' },
) {
  let existing: EditorTab | undefined
  if (fileHandle) {
    for (const tab of tabManager.allTabs) {
      if (!tab.fileHandle) continue
      if (tab.fileHandle === fileHandle || (await tab.fileHandle.isSameEntry(fileHandle))) {
        existing = tab
        break
      }
    }
  }
  if (existing) {
    if (options?.ifAlreadyOpen === 'skip') return
    tabManager.switchTab(existing.id, dryRunKeepOptions())
    return
  }

  const docSettings = new DocumentSettings()
  const loaded = docSettings.loadFromBytes(bytes)
  const editorState = editor.createState(loaded.text)

  const tab = tabManager.addTab({
    fileName,
    editorState,
    docSettings,
    fileHandle,
    activate: true,
  })

  if (tab) {
    syncUiFromTab(tab, dryRunKeepOptions())
    if (fileHandle) {
      void fileHandle.getFile().then((file) => {
        fileWatcher.markDiskSynced(tab.id, bytes, file)
      })
    }
  } else schedulePersistWorkspaceSession()
}

async function handleOpen() {
  try {
    if (typeof window.showOpenFilePicker === 'function') {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Tera Term Macro', accept: { 'text/plain': ['.ttl', '.txt'] } }],
        multiple: false,
      })
      const file = await handle.getFile()
      const bytes = await readFileAsBytes(file)
      await openFile(bytes, handle.name, handle)
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.ttl,.txt'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const bytes = await readFileAsBytes(file)
        await openFile(bytes, file.name, null)
      }
      input.click()
    }
  } catch {
    // user cancelled
  }
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function writeBytes(writable: FileSystemWritableFileStream, bytes: Uint8Array) {
  await writable.write(toBufferSource(bytes))
  await writable.close()
}

function isUserCancelError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

async function handleSave() {
  const tab = getActiveTab()
  const { bytes, warning } = tab.docSettings.prepareSave(editor.getValue())
  if (warning) {
    if (!confirm(`${warning}\n\nこのまま保存しますか？`)) return
  }

  fileWatcher.setSaving(tab.id, true)
  try {
    if (tab.fileHandle && 'createWritable' in tab.fileHandle) {
      const writable = await tab.fileHandle.createWritable()
      await writeBytes(writable, bytes)
    } else if (typeof window.showSaveFilePicker === 'function') {
      const handle = await window.showSaveFilePicker({
        suggestedName: tab.fileName === '未保存' ? 'macro.ttl' : tab.fileName,
        types: [{ description: 'Tera Term Macro', accept: { 'text/plain': ['.ttl'] } }],
      })
      const writable = await handle.createWritable()
      await writeBytes(writable, bytes)
      tab.fileHandle = handle
      tab.fileName = handle.name
    } else {
      downloadFile(bytes, tab.fileName === '未保存' ? 'macro.ttl' : tab.fileName)
      return
    }

    tabManager.markTabSaved()
    tabManager.setActiveFileName(tab.fileName)
    syncUiFromTab(tab, dryRunKeepOptions())
    persistWorkspaceSession()

    if (tab.fileHandle) {
      try {
        const file = await tab.fileHandle.getFile()
        fileWatcher.markDiskSynced(tab.id, bytes, file)
      } catch {
        fileWatcher.markDiskSynced(tab.id, bytes)
      }
    }
  } catch (err) {
    if (isUserCancelError(err)) return
    const message = err instanceof Error ? err.message : String(err)
    alert(`保存に失敗しました。\n${message}`)
  } finally {
    fileWatcher.setSaving(tab.id, false)
  }
}

function downloadFile(bytes: Uint8Array, filename: string) {
  const blob = new Blob([toBufferSource(bytes)])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  const tab = getActiveTab()
  tab.fileName = filename
  tab.fileHandle = null
  tabManager.markTabSaved()
  tabManager.setActiveFileName(filename)
  persistWorkspaceSession()
}

function handleEncodingChange(encoding: TextEncoding) {
  const tab = getActiveTab()
  const { text, warning } = tab.docSettings.changeEncoding(editor.getValue(), encoding)
  if (text !== editor.getValue()) {
    editor.setValue(text)
    runAnalysisNow(text)
  }
  tab.editorState = editor.getState()
  setEncodingSelect(encoding)
  updateStatusBar(tab)
  tabManager.notifyContentChanged()
  saveAppSettings({ defaultEncoding: encoding })
  if (warning) alert(warning)
}

function handleNewlineChange(newline: NewlineType) {
  const tab = getActiveTab()
  tab.docSettings.changeNewline(editor.getValue(), newline)
  setNewlineSelect(newline)
  updateStatusBar(tab)
  saveAppSettings({ defaultNewline: newline })
}

function handleThemeToggle() {
  applyTheme(!isDark)
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

let dryRunSession: DryRunSession | null = null
let dryRunRunId = 0
let dryRunActive = false
let dryRunRunPromise: Promise<DryRunState> | null = null
let dryRunClearedState: DryRunState | null = null
let dryRunOriginTabId: string | null = null
let dryRunSnapshot: DryRunSnapshot | null = null
const dryRunDialogAdapter = createBrowserDialogAdapter()

function isDryRunInProgress(): boolean {
  return dryRunActive || dryRunRunPromise !== null
}

function dryRunKeepOptions(): { keepDryRun: true } | undefined {
  return isDryRunInProgress() ? { keepDryRun: true } : undefined
}

function getDryRunOriginTab(): EditorTab | null {
  if (!dryRunOriginTabId) return null
  return tabManager.allTabs.find((t) => t.id === dryRunOriginTabId) ?? null
}

/** ドライラン起点から include バインディングを辿って到達できるタブ ID */
function collectDryRunLinkedTabIds(originTab: EditorTab): Set<string> {
  const linked = new Set<string>()
  const queue: EditorTab[] = [originTab]
  while (queue.length > 0) {
    const tab = queue.pop()!
    const bindings = getBindingsForTab(tab)
    for (const tabId of Object.values(bindings)) {
      if (linked.has(tabId)) continue
      linked.add(tabId)
      const next = tabManager.allTabs.find((t) => t.id === tabId)
      if (next) queue.push(next)
    }
  }
  return linked
}

function getBindingsForTab(tab: EditorTab): Record<string, string> {
  if (isDryRunInProgress() && dryRunSnapshot) {
    return dryRunSnapshot.bindings.get(tab.id) ?? tab.includeBindings
  }
  return tab.includeBindings
}

function isDryRunRelatedTab(closedTabId: string): boolean {
  if (closedTabId === dryRunOriginTabId) return true
  const origin = getDryRunOriginTab()
  if (!origin) return false
  return collectDryRunLinkedTabIds(origin).has(closedTabId)
}

function findTabForLocationPrefixInTab(prefix: string, tab: EditorTab): EditorTab | null {
  const bindings = getBindingsForTab(tab)
  const directBinding = bindings[prefix]
  if (directBinding) {
    return tabManager.allTabs.find((t) => t.id === directBinding) ?? null
  }
  const fromBindingKey = resolveIncludeBindingTabId(bindings, prefix)
  if (fromBindingKey) {
    return tabManager.allTabs.find((t) => t.id === fromBindingKey) ?? null
  }

  const normalized = normalizeIncludePath(prefix)

  const fromStatic = resolveIncludeBindingTabId(bindings, normalized, undefined, normalized)
  if (fromStatic) {
    return tabManager.allTabs.find((t) => t.id === fromStatic) ?? null
  }

  const loopSuffix = /^(.+)@([a-zA-Z_]\w*)=(-?\d+)$/.exec(prefix)
  if (loopSuffix) {
    const [, rawPart, , valueStr] = loopSuffix
    const loopValue = Number(valueStr)
    const dynamicKey = includeDynamicBindingKey(rawPart!)
    const fromDynamic = resolveIncludeBindingTabId(bindings, dynamicKey, rawPart, rawPart)
    if (fromDynamic) {
      return tabManager.allTabs.find((t) => t.id === fromDynamic) ?? null
    }
    const pathKey = resolveIncludePathBindingKey(rawPart!)
    if (pathKey) {
      const fromPath = resolveIncludeBindingTabId(bindings, pathKey, rawPart, rawPart)
      if (fromPath) {
        return tabManager.allTabs.find((t) => t.id === fromPath) ?? null
      }
    }
    for (const [key, tabId] of Object.entries(bindings)) {
      if (key.startsWith('@loop:L') && key.endsWith(`:${loopValue}`)) {
        return tabManager.allTabs.find((t) => t.id === tabId) ?? null
      }
    }
  } else {
    const dynamicKey = includeDynamicBindingKey(prefix)
    const fromDynamic = resolveIncludeBindingTabId(bindings, dynamicKey, prefix, prefix)
    if (fromDynamic) {
      return tabManager.allTabs.find((t) => t.id === fromDynamic) ?? null
    }
    const pathKey = resolveIncludePathBindingKey(prefix)
    if (pathKey) {
      const fromPath = resolveIncludeBindingTabId(bindings, pathKey, prefix, prefix)
      if (fromPath) {
        return tabManager.allTabs.find((t) => t.id === fromPath) ?? null
      }
    }
  }

  return null
}

function findTabForLocationPrefix(prefix: string, contextTab: EditorTab | null): EditorTab | null {
  const directTab = tabManager.allTabs.find((tab) => tab.id === prefix)
  if (directTab) return directTab
  if (!contextTab) return null

  const normalized = normalizeIncludePath(prefix)
  const fromContext = findTabForLocationPrefixInTab(prefix, contextTab)
  if (fromContext) return fromContext

  for (const tabId of collectDryRunLinkedTabIds(contextTab)) {
    const linkedTab = tabManager.allTabs.find((t) => t.id === tabId)
    if (!linkedTab) continue
    const fromLinked = findTabForLocationPrefixInTab(prefix, linkedTab)
    if (fromLinked) return fromLinked
  }

  const matches = tabManager.allTabs.filter(
    (tab) => tab.fileName === prefix || tab.fileName === normalized,
  )
  return matches.length === 1 ? matches[0]! : null
}

function dryRunLocationMatchesActiveTab(location: string | undefined): boolean {
  if (!location) return false
  const tab = tabManager.activeTab
  if (!tab) return false
  if (isDryRunMainLocation(location)) {
    return tab.id === dryRunOriginTabId
  }
  const prefixed = /^(.*):L\d+$/.exec(location)
  if (!prefixed) return false
  const contextTab = getDryRunOriginTab() ?? tab
  const targetTab = findTabForLocationPrefix(prefixed[1]!, contextTab)
  return targetTab?.id === tab.id
}

function gotoTtlLocation(location: string, contextTab: EditorTab | null): boolean {
  const keepDryRun = dryRunKeepOptions()
  const mainMatch = /^L(\d+)$/.exec(location)
  if (mainMatch) {
    if (contextTab && tabManager.activeTab?.id !== contextTab.id) {
      tabManager.switchTab(contextTab.id, keepDryRun)
    }
    editor.gotoLine(Number(mainMatch[1]))
    refreshDryRunHighlight()
    return true
  }
  const prefixed = /^(.*):L(\d+)$/.exec(location)
  if (!prefixed) return false
  const [, prefix, lineStr] = prefixed
  const targetTab = findTabForLocationPrefix(prefix!, contextTab)
  if (targetTab) {
    tabManager.switchTab(targetTab.id, keepDryRun)
    editor.gotoLine(Number(lineStr))
    refreshDryRunHighlight()
    return true
  }
  return false
}

function gotoSendLocation(location: string): void {
  if (!gotoTtlLocation(location, tabManager.activeTab)) {
    setStatusMessage('送信データの参照先タブを特定できません')
  }
}

function gotoDryRunLocation(location: string): void {
  gotoTtlLocation(location, getDryRunOriginTab() ?? tabManager.activeTab)
}

function gotoFlowchartLocation(location: string): void {
  if (!gotoTtlLocation(location, tabManager.activeTab)) {
    setStatusMessage('フローチャートの参照先タブを特定できません')
  }
}

function refreshDryRunHighlight(): void {
  const session = dryRunSession
  if (session) applyDryRunExecutionHighlight(session.getState())
}

function applyDryRunExecutionHighlight(state: DryRunState): void {
  if (state.status === 'waiting-dialog' || state.status === 'running') {
    if (dryRunLocationMatchesActiveTab(state.currentLocation)) {
      editor.setExecutionLine(state.currentLine, state.status === 'waiting-dialog')
    } else {
      editor.clearExecutionLine()
    }
    return
  }
  if (state.status === 'finished' || state.status === 'stopped' || state.status === 'error') {
    editor.clearExecutionLine()
  }
}

function stopDryRun(): void {
  dryRunActive = false
  dryRunRunPromise = null
  dryRunSnapshot = null
  const session = dryRunSession
  if (session) {
    session.stop()
    sidePanel.updateDryRun(session.getState())
    cancelActiveTtlDialog()
    dryRunSession = null
  } else {
    cancelActiveTtlDialog()
  }
  dryRunRunId++
  setDryRunToolbarState(false)
  editor.clearExecutionLine()
  editor.setDryRunLocked(false)
  runAnalysisNow(editor.getValue())
  updateCursorPosition()
}

async function startDryRun(): Promise<void> {
  if (dryRunActive || dryRunRunPromise) return
  const tab = tabManager.activeTab
  const currentSource = editor.getValue()
  if (tab) {
    syncTabIncludeBindings(tab, currentSource)
    const limitations = collectAnalysisLimitations(tab, currentSource)
    const dryRunLimitations: AnalysisLimitations = {
      unassumedBranches: [],
      unlinkedIncludes: limitations.unlinkedIncludes,
    }
    if (
      hasAnalysisLimitations(dryRunLimitations)
      && !confirm(
        `${formatAnalysisLimitationWarning(dryRunLimitations)}\n\n`
        + 'タブ未指定の include はドライランで実行できません。\n'
        + 'このままドライランを開始しますか？',
      )
    ) {
      return
    }
  }
  dryRunActive = true
  const runId = ++dryRunRunId
  dryRunSnapshot = tab ? snapshotDryRunContext(tab) : null
  const sourceSnapshot =
    tab && dryRunSnapshot ? dryRunSnapshot.contents.get(tab.id) ?? editor.getValue() : editor.getValue()
  const resolver =
    tab && dryRunSnapshot
      ? createIncludeResolver(tab, dryRunSnapshot)
      : tab
        ? createIncludeResolver(tab)
        : undefined

  dryRunOriginTabId = tab?.id ?? null
  dryRunClearedState = null
  setDryRunToolbarState(true)
  editor.setDryRunLocked(true)
  sidePanel.showTab('dryrun')
  sidePanel.updateDryRun({ status: 'running', currentLine: 1, events: [] })

  const session = new DryRunSession({
    source: sourceSnapshot,
    includeResolver: resolver,
    dialogAdapter: dryRunDialogAdapter,
    onStateChange(state) {
      if (runId !== dryRunRunId) return
      sidePanel.updateDryRun(state)
      applyDryRunExecutionHighlight(state)
      if (state.status === 'finished' || state.status === 'stopped' || state.status === 'error') {
        setDryRunToolbarState(false)
      }
    },
    async yieldEveryLine() {
      await new Promise((r) => setTimeout(r, 0))
    },
  })

  dryRunSession = session
  dryRunRunPromise = session.run()
  try {
    await dryRunRunPromise
  } finally {
    if (runId === dryRunRunId) {
      dryRunRunPromise = null
      dryRunSession = null
      dryRunActive = false
      dryRunSnapshot = null
      setDryRunToolbarState(false)
      editor.clearExecutionLine()
      editor.setDryRunLocked(false)
      runAnalysisNow(editor.getValue())
      updateCursorPosition()
    }
  }
}

function handleCloseTab() {
  const tab = tabManager.activeTab
  if (tab && tabManager.closeTab(tab.id)) {
    schedulePersistWorkspaceSession()
  }
}

createToolbar(document.querySelector('#toolbar')!, editor, {
  onNew: handleNew,
  onOpen: handleOpen,
  onSave: handleSave,
  onThemeToggle: handleThemeToggle,
  onEncodingChange: handleEncodingChange,
  onNewlineChange: handleNewlineChange,
  onCloseTab: handleCloseTab,
  onGotoLine: handleGotoLine,
  onSwitchTab: (index) => tabManager.switchToIndex(index),
  onSwitchTabRelative: (delta) => tabManager.switchRelativeTab(delta),
  onDryRunStart: () => {
    void startDryRun()
  },
  onDryRunStop: stopDryRun,
})

sidePanel.onGotoDryRunLocation(gotoDryRunLocation)
sidePanel.onGotoSendLocation(gotoSendLocation)
sidePanel.onGotoFlowchartLocation(gotoFlowchartLocation)
sidePanel.onFlowchartDetailedWaitsChange((show) => {
  flowchartShowDetailedWaits = show
  saveAppSettings({ flowchartShowDetailedWaits: show })
  refreshFlowchart()
})
sidePanel.onFlowchartAssignmentsChange((show) => {
  flowchartShowAssignments = show
  saveAppSettings({ flowchartShowAssignments: show })
  refreshFlowchart()
})

sidePanel.onClearDryRun(() => {
  if (dryRunActive || dryRunRunPromise !== null) stopDryRun()
  dryRunOriginTabId = null
  dryRunClearedState = { status: 'idle', currentLine: 0, events: [] }
  sidePanel.updateDryRun(dryRunClearedState)
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
  runAnalysisNow(editor.getValue())
})

document.querySelector('#tab-add')!.addEventListener('click', handleNewTab)

function isOpenableFile(file: File): boolean {
  return /\.(ttl|txt)$/i.test(file.name)
}

function setupFileDrop() {
  const dropTarget = document.querySelector('#app')!

  const showDrag = (on: boolean) => {
    dropTarget.classList.toggle('file-drop-active', on)
  }

  dropTarget.addEventListener(
    'dragover',
    (e) => {
      const de = e as DragEvent
      if (!Array.from(de.dataTransfer?.items ?? []).some((item) => item.kind === 'file')) return
      e.preventDefault()
      showDrag(true)
    },
    true,
  )

  dropTarget.addEventListener('dragleave', (e) => {
    if (e.currentTarget === dropTarget && !dropTarget.contains((e as DragEvent).relatedTarget as Node)) {
      showDrag(false)
    }
  })

  dropTarget.addEventListener(
    'drop',
    async (e) => {
      const de = e as DragEvent
      const files = Array.from(de.dataTransfer?.files ?? []).filter(isOpenableFile)
      if (files.length === 0) return

      e.preventDefault()
      e.stopPropagation()
      showDrag(false)

      for (const file of files) {
        if (!tabManager.canAddTab()) {
          alert(`タブは最大 ${MAX_TABS} 個まで開けます。`)
          break
        }
        const bytes = await readFileAsBytes(file)
        await openFile(bytes, file.name, null)
      }
    },
    true,
  )
}

setupFileDrop()

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
