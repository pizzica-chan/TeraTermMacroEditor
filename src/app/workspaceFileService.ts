import { DocumentSettings } from '../text/documentSettings'
import type { TextEncoding, NewlineType } from '../text/types'
import type { EditorTab } from '../ui/tabManager'
import { MAX_TABS } from '../ui/tabManager'
import { createDefaultDocumentSettings, saveAppSettings } from '../storage/appSettings'
import type { EditorState } from '@codemirror/state'

export interface WorkspaceFileServiceHost {
  getActiveTab(): EditorTab
  allTabs: () => readonly EditorTab[]
  canAddTab(): boolean
  addTab(options: {
    fileName: string
    editorState?: EditorState
    docSettings?: DocumentSettings
    fileHandle?: FileSystemFileHandle | null
    activate?: boolean
  }): EditorTab | null
  switchTab(tabId: string, options?: { keepDryRun?: boolean }): void
  getEditorValue(): string
  setEditorValue(text: string): void
  getEditorState(): EditorState
  createEditorState(text: string): EditorState
  markTabSaved(): void
  setActiveFileName(name: string): void
  notifyContentChanged(): void
  hasExternalChangePending(tab: EditorTab): boolean
  dryRunKeepOptions(): { keepDryRun: true } | undefined
  stopDryRunIfRunning(): void
  syncUiFromTab(tab: EditorTab, options?: { keepDryRun?: boolean }): void
  runAnalysisNow(text: string): void
  updateStatusBar(tab: EditorTab): void
  setEncodingSelect(encoding: TextEncoding): void
  setNewlineSelect(newline: NewlineType): void
  persistWorkspaceSession(): void
  schedulePersistWorkspaceSession(): void
  markDiskSynced(tabId: string, bytes: Uint8Array, file?: File): void
  setSaving(tabId: string, saving: boolean): void
  pollFileWatcherNow(): void
}

export async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
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

function isOpenableFile(file: File): boolean {
  return /\.(ttl|txt)$/i.test(file.name)
}

function dropFileDedupeKey(file: File): string {
  return `${file.webkitRelativePath || ''}\0${file.name}\0${file.size}\0${file.lastModified}`
}

function hasFileDataTransfer(dt: DataTransfer | null): boolean {
  if (!dt) return false
  if ((dt.files?.length ?? 0) > 0) return true
  return Array.from(dt.items).some((item) => item.kind === 'file')
}

/** drop イベント中に同期的に File を集める（await 後の getAsFile() は null になり得る） */
export function collectDropFileEntries(
  de: DragEvent,
): Array<{ file: File; item: DataTransferItem | null }> {
  const dt = de.dataTransfer
  if (!dt) return []

  const entries: Array<{ file: File; item: DataTransferItem | null }> = []
  const claimedFiles = new Set<File>()
  const claimedKeysFromItems = new Set<string>()

  const tryAdd = (file: File, item: DataTransferItem | null, fromItems: boolean) => {
    if (!isOpenableFile(file)) return
    if (claimedFiles.has(file)) return
    const key = dropFileDedupeKey(file)
    // items と files の二重掲載だけキーで除外。同一メタデータの別 File は残す。
    if (!fromItems && claimedKeysFromItems.has(key)) return
    claimedFiles.add(file)
    if (fromItems) claimedKeysFromItems.add(key)
    entries.push({ file, item })
  }

  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) tryAdd(file, item, true)
  }

  for (const file of Array.from(dt.files)) {
    tryAdd(file, null, false)
  }

  return entries
}

async function resolveDropFileHandle(item: DataTransferItem | null): Promise<FileSystemFileHandle | null> {
  if (!item || typeof item.getAsFileSystemHandle !== 'function') return null
  try {
    const handle = await item.getAsFileSystemHandle()
    return handle.kind === 'file' ? (handle as FileSystemFileHandle) : null
  } catch {
    return null
  }
}

export function createWorkspaceFileService(host: WorkspaceFileServiceHost) {
  async function openFile(
    bytes: Uint8Array,
    fileName: string,
    fileHandle: FileSystemFileHandle | null,
    options?: { ifAlreadyOpen?: 'switch' | 'skip'; sourceFile?: File },
  ) {
    let existing: EditorTab | undefined
    if (fileHandle) {
      for (const tab of host.allTabs()) {
        if (!tab.fileHandle) continue
        if (
          tab.fileHandle === fileHandle ||
          (tab.fileHandle.isSameEntry && (await tab.fileHandle.isSameEntry(fileHandle)))
        ) {
          existing = tab
          break
        }
      }
    }
    if (existing) {
      if (options?.ifAlreadyOpen === 'skip') return
      host.switchTab(existing.id, host.dryRunKeepOptions())
      host.pollFileWatcherNow()
      return
    }

    const docSettings = new DocumentSettings()
    const loaded = docSettings.loadFromBytes(bytes)
    const editorState = host.createEditorState(loaded.text)

    const tab = host.addTab({
      fileName,
      editorState,
      docSettings,
      fileHandle,
      activate: true,
    })

    if (tab) {
      host.syncUiFromTab(tab, host.dryRunKeepOptions())
      if (fileHandle) {
        if (options?.sourceFile) {
          host.markDiskSynced(tab.id, bytes, options.sourceFile)
        } else {
          void fileHandle.getFile().then((file) => {
            host.markDiskSynced(tab.id, bytes, file)
          })
        }
      }
    } else host.schedulePersistWorkspaceSession()
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
        await openFile(bytes, handle.name, handle, { sourceFile: file })
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

  function downloadFile(bytes: Uint8Array, filename: string) {
    const blob = new Blob([toBufferSource(bytes)])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    const tab = host.getActiveTab()
    tab.fileName = filename
    tab.fileHandle = null
    host.markTabSaved()
    host.setActiveFileName(filename)
    host.persistWorkspaceSession()
  }

  async function handleSave() {
    const tab = host.getActiveTab()
    const { bytes, warning } = tab.docSettings.prepareSave(host.getEditorValue())
    if (warning) {
      if (!confirm(`${warning}\n\nこのまま保存しますか？`)) return
    }

    if (host.hasExternalChangePending(tab)) {
      if (
        !confirm(
          `「${tab.fileName}」はディスク上で他のプログラムにより更新されています（↻）。\n\n` +
            `保存すると、ディスクの変更内容は失われ、エディタの内容が書き込まれます。\n\n保存しますか？`,
        )
      ) {
        return
      }
    }

    host.setSaving(tab.id, true)
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

      host.markTabSaved()
      host.setActiveFileName(tab.fileName)
      host.syncUiFromTab(tab, host.dryRunKeepOptions())
      host.persistWorkspaceSession()

      if (tab.fileHandle) {
        // 保存直後の getFile() はキャッシュで古い場合があるため、書き込みバイトで同期する
        host.markDiskSynced(tab.id, bytes)
      }
    } catch (err) {
      if (isUserCancelError(err)) return
      const message = err instanceof Error ? err.message : String(err)
      alert(`保存に失敗しました。\n${message}`)
    } finally {
      host.setSaving(tab.id, false)
    }
  }

  function handleNewTab() {
    if (!host.canAddTab()) {
      alert(`タブは最大 ${MAX_TABS} 個まで開けます。`)
      return
    }
    host.stopDryRunIfRunning()
    host.addTab({
      fileName: '未保存',
      docSettings: createDefaultDocumentSettings(),
      activate: true,
    })
  }

  function handleEncodingChange(encoding: TextEncoding) {
    const tab = host.getActiveTab()
    const { text, warning } = tab.docSettings.changeEncoding(host.getEditorValue(), encoding)
    if (text !== host.getEditorValue()) {
      host.setEditorValue(text)
      host.runAnalysisNow(text)
    }
    tab.editorState = host.getEditorState()
    host.setEncodingSelect(encoding)
    host.updateStatusBar(tab)
    host.notifyContentChanged()
    saveAppSettings({ defaultEncoding: encoding })
    if (warning) alert(warning)
  }

  function handleNewlineChange(newline: NewlineType) {
    const tab = host.getActiveTab()
    tab.docSettings.changeNewline(host.getEditorValue(), newline)
    host.setNewlineSelect(newline)
    host.updateStatusBar(tab)
    saveAppSettings({ defaultNewline: newline })
  }

  function setupFileDrop(dropTarget: Element) {
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
        if (!hasFileDataTransfer(de.dataTransfer)) return

        e.preventDefault()
        e.stopPropagation()
        showDrag(false)

        const entries = collectDropFileEntries(de)
        for (const { file, item } of entries) {
          if (!host.canAddTab()) {
            alert(`タブは最大 ${MAX_TABS} 個まで開けます。`)
            break
          }
          const fileHandle = await resolveDropFileHandle(item)
          const bytes = await readFileAsBytes(file)
          await openFile(bytes, file.name, fileHandle, { sourceFile: file })
        }
      },
      true,
    )
  }

  return {
    readFileAsBytes,
    openFile,
    handleOpen,
    handleSave,
    handleNewTab,
    handleEncodingChange,
    handleNewlineChange,
    setupFileDrop,
  }
}

export type WorkspaceFileService = ReturnType<typeof createWorkspaceFileService>
