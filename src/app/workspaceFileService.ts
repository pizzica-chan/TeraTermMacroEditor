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

  async function resolveDropFileEntry(
    item: DataTransferItem,
  ): Promise<{ file: File; fileHandle: FileSystemFileHandle | null } | null> {
    if (item.kind !== 'file') return null
    const file = item.getAsFile()
    if (!file || !isOpenableFile(file)) return null

    let fileHandle: FileSystemFileHandle | null = null
    if (typeof item.getAsFileSystemHandle === 'function') {
      try {
        const handle = await item.getAsFileSystemHandle()
        if (handle.kind === 'file') fileHandle = handle as FileSystemFileHandle
      } catch {
        // ハンドル取得不可時は内容のみ読み込む
      }
    }
    return { file, fileHandle }
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
        const items = Array.from(de.dataTransfer?.items ?? [])
        if (items.every((item) => item.kind !== 'file')) return

        e.preventDefault()
        e.stopPropagation()
        showDrag(false)

        for (const item of items) {
          const entry = await resolveDropFileEntry(item)
          if (!entry) continue
          if (!host.canAddTab()) {
            alert(`タブは最大 ${MAX_TABS} 個まで開けます。`)
            break
          }
          const bytes = await readFileAsBytes(entry.file)
          await openFile(bytes, entry.file.name, entry.fileHandle, { sourceFile: entry.file })
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
