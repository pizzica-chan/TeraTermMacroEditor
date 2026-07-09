import './style.css'
import { createEditor, SAMPLE_MACRO } from './editor/createEditor'
import { createSidePanel } from './ui/sidePanel'
import {
  createToolbar,
  setThemeButton,
  setEncodingSelect,
  setNewlineSelect,
  setStatusMessage,
} from './ui/toolbar'
import { TabManager, type EditorTab } from './ui/tabManager'
import { analyzeTTL, type IncludeResolver } from './ttl/analyzer'
import { findIncludeRefs, normalizeIncludePath } from './ttl/includeRefs'
import { createIncludePanel } from './ui/includePanel'
import { setIncludeResolver, setExternallyUsedNames } from './ttl/analysisContext'
import { evaluateTTL } from './ttl/evaluator'
import { DocumentSettings } from './text/documentSettings'
import type { TextEncoding, NewlineType } from './text/types'
import { ENCODING_LABELS, NEWLINE_LABELS } from './text/types'

let isDark = true

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header id="toolbar"></header>
  <div class="tab-bar">
    <div class="tab-list" id="tab-list"></div>
    <button id="tab-add" class="tab-add-btn" title="新しいタブ">+</button>
  </div>
  <main class="main-layout">
    <section class="editor-pane">
      <div id="editor"></div>
    </section>
    <aside class="side-pane" id="side-panel"></aside>
  </main>
  <footer class="status-bar">
    <span id="status-position">Ln 1, Col 1</span>
    <span id="status-encoding"></span>
    <span id="status-lang">Tera Term Macro (TTL)</span>
  </footer>
`

const editor = createEditor(document.querySelector('#editor')!, '')
const sidePanel = createSidePanel(document.querySelector('#side-panel')!)
const includePanel = createIncludePanel(document.querySelector('#side-panel')!)
sidePanel.onGotoLine((line) => editor.gotoLine(line))

function getActiveTab(): EditorTab {
  const tab = tabManager.activeTab
  if (!tab) throw new Error('No active tab')
  return tab
}

function syncUiFromTab(tab: EditorTab): void {
  setEncodingSelect(tab.docSettings.encoding)
  setNewlineSelect(tab.docSettings.newline)
  updateStatusBar(tab)
  runAnalysis(editor.getValue())
  updateCursorPosition()
}

function updateStatusBar(tab: EditorTab): void {
  setStatusMessage(`${ENCODING_LABELS[tab.docSettings.encoding]} / ${NEWLINE_LABELS[tab.docSettings.newline]}`)
}

function createIncludeResolver(tab: EditorTab): IncludeResolver {
  return {
    resolve(path: string) {
      const key = normalizeIncludePath(path)
      const linkedTabId = tab.includeBindings[key]
      if (!linkedTabId) return null
      const linkedTab = tabManager.allTabs.find((t) => t.id === linkedTabId)
      if (!linkedTab) return null
      return tabManager.getTabContent(linkedTab)
    },
  }
}

function getExternallyUsedVarNames(tab: EditorTab): Set<string> {
  const used = new Set<string>()
  for (const parentTab of tabManager.allTabs) {
    if (parentTab.id === tab.id) continue
    const includesThis = Object.values(parentTab.includeBindings).includes(tab.id)
    if (!includesThis) continue
    const parentResult = analyzeTTL(tabManager.getTabContent(parentTab), {
      includeResolver: createIncludeResolver(parentTab),
    })
    for (const variable of parentResult.variables) {
      if (variable.isUsed && !variable.isSystem) {
        used.add(variable.name.toLowerCase())
      }
    }
  }
  return used
}

function updateAnalysisContext(tab: EditorTab | null): void {
  if (!tab) {
    setIncludeResolver(undefined)
    setExternallyUsedNames(undefined)
    return
  }
  setIncludeResolver(createIncludeResolver(tab))
  setExternallyUsedNames(getExternallyUsedVarNames(tab))
}

function runAnalysis(text: string) {
  const tab = tabManager.activeTab
  updateAnalysisContext(tab)
  editor.notifyIncludeGraphChanged()

  const result = analyzeTTL(text, {
    includeResolver: tab ? createIncludeResolver(tab) : undefined,
    externallyUsedNames: tab ? getExternallyUsedVarNames(tab) : undefined,
  })
  const evaluation = evaluateTTL(text, {
    includeResolver: tab ? createIncludeResolver(tab) : undefined,
  })
  sidePanel.update({ analysis: result, sendEntries: evaluation.sendEntries })
  refreshIncludePanel(text)
}

function buildTabNameMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const t of tabManager.allTabs) map[t.id] = t.fileName
  return map
}

function refreshIncludePanel(text?: string) {
  const tab = tabManager.activeTab
  if (!tab) return

  const source = text ?? editor.getValue()
  const refs = findIncludeRefs(source)
  const otherTabs = tabManager.getOtherTabs(tab.id)

  includePanel.update(refs, tab, otherTabs, {
    onBindingChange(path, tabId) {
      if (tabId) tab.includeBindings[path] = tabId
      else delete tab.includeBindings[path]
      runAnalysis(editor.getValue())
    },
    onGotoLine(line) {
      editor.gotoLine(line)
    },
    onOpenLinkedTab(tabId) {
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
)

editor.onChange((text) => {
  tabManager.activeTab?.docSettings.markDirty()
  tabManager.notifyContentChanged()
  runAnalysis(text)
  updateCursorPosition()
})

function updateCursorPosition() {
  const pos = editor.view.state.selection.main.head
  const line = editor.view.state.doc.lineAt(pos)
  const col = pos - line.from + 1
  const statusEl = document.querySelector('#status-position')
  if (statusEl) statusEl.textContent = `Ln ${line.number}, Col ${col}`
}

editor.view.dom.addEventListener('keyup', updateCursorPosition)
editor.view.dom.addEventListener('click', updateCursorPosition)

function handleNewTab() {
  if (!tabManager.canAddTab()) return
  tabManager.addTab({ fileName: '未保存', activate: true })
}

function handleNew() {
  handleNewTab()
}

async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}

async function openFile(bytes: Uint8Array, fileName: string, fileHandle: FileSystemFileHandle | null) {
  const existing = tabManager.findByFileName(fileName)
  if (existing && existing.fileHandle === fileHandle) {
    tabManager.switchTab(existing.id)
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

  if (tab) syncUiFromTab(tab)
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
    syncUiFromTab(tab)
  } catch (err) {
    if (isUserCancelError(err)) return
    const message = err instanceof Error ? err.message : String(err)
    alert(`保存に失敗しました。\n${message}`)
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
}

function handleEncodingChange(encoding: TextEncoding) {
  const tab = getActiveTab()
  const { text, warning } = tab.docSettings.changeEncoding(editor.getValue(), encoding)
  if (text !== editor.getValue()) {
    editor.setValue(text)
    runAnalysis(text)
  }
  tab.editorState = editor.getState()
  setEncodingSelect(encoding)
  updateStatusBar(tab)
  tabManager.notifyContentChanged()
  if (warning) alert(warning)
}

function handleNewlineChange(newline: NewlineType) {
  const tab = getActiveTab()
  tab.docSettings.changeNewline(editor.getValue(), newline)
  setNewlineSelect(newline)
  updateStatusBar(tab)
}

function handleThemeToggle() {
  isDark = !isDark
  editor.setTheme(isDark)
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  setThemeButton(isDark)
}

function handleCloseTab() {
  const tab = tabManager.activeTab
  if (tab) tabManager.closeTab(tab.id)
}

createToolbar(document.querySelector('#toolbar')!, editor, {
  onNew: handleNew,
  onOpen: handleOpen,
  onSave: handleSave,
  onThemeToggle: handleThemeToggle,
  onEncodingChange: handleEncodingChange,
  onNewlineChange: handleNewlineChange,
  onCloseTab: handleCloseTab,
})

document.querySelector('#tab-add')!.addEventListener('click', handleNewTab)

document.documentElement.dataset.theme = 'dark'

// 初期タブ（サンプルマクロ）
const initialTab = tabManager.addTab({
  fileName: 'サンプル.ttl',
  editorState: editor.createState(SAMPLE_MACRO),
  activate: true,
})
if (initialTab) syncUiFromTab(initialTab)

window.addEventListener('beforeunload', (e) => {
  if (tabManager.hasUnsavedChanges()) {
    e.preventDefault()
    e.returnValue = ''
  }
})
