import type { EditorInstance } from '../editor/createEditor'
import type { TextEncoding, NewlineType } from '../text/types'
import { ENCODING_LABELS, NEWLINE_LABELS } from '../text/types'

export interface ToolbarActions {
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onThemeToggle: () => void
  onEncodingChange: (encoding: TextEncoding) => void
  onNewlineChange: (newline: NewlineType) => void
  onCloseTab?: () => void
  onGotoLine?: () => void
  onSwitchTab?: (index: number) => void
  onSwitchTabRelative?: (delta: number) => void
}

let suppressSelectChange = false

export function createToolbar(container: HTMLElement, editor: EditorInstance, actions: ToolbarActions): void {
  container.innerHTML = `
    <div class="toolbar-left">
      <span class="app-title">TTL Macro Editor</span>
      <div class="toolbar-divider"></div>
      <button id="btn-new" title="新規 (Ctrl+N)">新規</button>
      <button id="btn-open" title="開く (Ctrl+O)">開く</button>
      <button id="btn-save" title="保存 (Ctrl+S)">保存</button>
      <div class="toolbar-divider"></div>
      <button id="btn-undo" title="元に戻す (Ctrl+Z)">↶ 戻す</button>
      <button id="btn-redo" title="やり直し (Ctrl+Y)">↷ やり直し</button>
    </div>
    <div class="toolbar-right">
      <label class="toolbar-select-label" title="文字コード">
        <span class="select-caption">文字コード</span>
        <select id="sel-encoding">
          <option value="UTF-8">${ENCODING_LABELS['UTF-8']}</option>
          <option value="SJIS">${ENCODING_LABELS.SJIS}</option>
        </select>
      </label>
      <label class="toolbar-select-label" title="改行コード">
        <span class="select-caption">改行</span>
        <select id="sel-newline">
          <option value="LF">${NEWLINE_LABELS.LF}</option>
          <option value="CRLF">${NEWLINE_LABELS.CRLF}</option>
          <option value="CR">${NEWLINE_LABELS.CR}</option>
        </select>
      </label>
      <div class="toolbar-divider"></div>
      <button id="btn-theme" title="テーマ切替">🌙</button>
    </div>
  `

  container.querySelector('#btn-new')!.addEventListener('click', actions.onNew)
  container.querySelector('#btn-open')!.addEventListener('click', actions.onOpen)
  container.querySelector('#btn-save')!.addEventListener('click', actions.onSave)
  container.querySelector('#btn-undo')!.addEventListener('click', () => editor.undo())
  container.querySelector('#btn-redo')!.addEventListener('click', () => editor.redo())
  container.querySelector('#btn-theme')!.addEventListener('click', actions.onThemeToggle)

  container.querySelector('#sel-encoding')!.addEventListener('change', (e) => {
    if (suppressSelectChange) return
    actions.onEncodingChange((e.target as HTMLSelectElement).value as TextEncoding)
  })

  container.querySelector('#sel-newline')!.addEventListener('change', (e) => {
    if (suppressSelectChange) return
    actions.onNewlineChange((e.target as HTMLSelectElement).value as NewlineType)
  })

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Tab') {
        e.preventDefault()
        actions.onSwitchTabRelative?.(e.shiftKey ? -1 : 1)
        return
      }

      const digit = Number(e.key)
      if (digit >= 1 && digit <= 9) {
        e.preventDefault()
        actions.onSwitchTab?.(digit - 1)
        return
      }

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault()
          actions.onNew()
          break
        case 'o':
          e.preventDefault()
          actions.onOpen()
          break
        case 's':
          e.preventDefault()
          actions.onSave()
          break
        case 'w':
          e.preventDefault()
          actions.onCloseTab?.()
          break
        case 'g':
          e.preventDefault()
          actions.onGotoLine?.()
          break
        case 'z':
          if (!e.shiftKey) {
            e.preventDefault()
            editor.undo()
          }
          break
        case 'y':
          e.preventDefault()
          editor.redo()
          break
      }
    }
  })
}

export function setThemeButton(dark: boolean): void {
  const btn = document.querySelector('#btn-theme')
  if (btn) btn.textContent = dark ? '☀️' : '🌙'
}

export function setEncodingSelect(encoding: TextEncoding): void {
  const sel = document.querySelector<HTMLSelectElement>('#sel-encoding')
  if (!sel) return
  suppressSelectChange = true
  sel.value = encoding
  suppressSelectChange = false
}

export function setNewlineSelect(newline: NewlineType): void {
  const sel = document.querySelector<HTMLSelectElement>('#sel-newline')
  if (!sel) return
  suppressSelectChange = true
  sel.value = newline
  suppressSelectChange = false
}

export function setStatusMessage(message: string): void {
  const el = document.querySelector('#status-encoding')
  if (el) el.textContent = message
}
