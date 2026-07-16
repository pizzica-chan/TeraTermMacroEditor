import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { acceptCompletion, completionKeymap, completionStatus, startCompletion } from '@codemirror/autocomplete'
import { lintGutter } from '@codemirror/lint'
import { ttlLanguage, ttlHighlightExtension } from '../ttl/language'
import { ttlLinter } from '../ttl/linter'
import { valueTooltipExtension } from '../ttl/valueTooltip'
import { ttlAutocompletion } from '../ttl/completion'
import { includeDecorationExtension, applyIncludeDecorations, type IncludeDecorationInfo } from './includeDecorations'
import { executionDecorationExtension, applyExecutionLine, clearExecutionLine } from './executionDecorations'
import {
  branchAssumptionDecorationExtension,
  applyBranchAssumptionDecorations,
  type BranchAssumptionDecoration,
} from './branchAssumptionDecorations'
import { includeGraphRevisionExtension, bumpIncludeGraphRevision, bumpAnalysisCacheRevision } from '../ttl/analysisContext'
import { createEditorHistoryExtension, PROGRAM_REPLACE_USER_EVENT } from './editorHistory'

const SAMPLE_MACRO = `; Tera Term マクロ サンプル
; 自動ログインの例

timeout = 30
hostname = '192.168.1.1'
username = 'admin'
password = 'secret'

; SSH接続
connect hostname

; ログインプロンプトを待機
UsernamePrompt = 'login:'
PasswordPrompt = 'Password:'

while 1
  wait UsernamePrompt
  sendln username

  wait PasswordPrompt
  sendln password

  ; プロンプト確認
  wait '$'
  break
endwhile

messagebox 'ログイン完了' 'info'
end
`

export interface EditorInstance {
  view: EditorView
  setTheme: (dark: boolean) => void
  getValue: () => string
  setValue: (text: string) => void
  getState: () => EditorState
  setState: (state: EditorState) => void
  createState: (doc?: string) => EditorState
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  focus: () => void
  onChange: (callback: (text: string) => void) => void
  gotoLine: (line: number) => void
  setIncludeDecorations: (info: IncludeDecorationInfo | null) => void
  setBranchAssumptionDecorations: (assumptions: BranchAssumptionDecoration[] | null) => void
  notifyIncludeGraphChanged: () => void
  notifyAnalysisCacheChanged: () => void
  setExecutionLine: (line: number | null, waiting?: boolean) => void
  clearExecutionLine: () => void
  setDryRunLocked: (locked: boolean) => void
}

const themeCompartment = new Compartment()
const editableCompartment = new Compartment()

function hasCompletionPrefix(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  return /[a-zA-Z_]\w*$/.test(before)
}

function buildExtensions(onDocChange: (text: string) => void): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    createEditorHistoryExtension(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    ttlHighlightExtension,
    ttlLanguage,
    lintGutter(),
    ttlLinter,
    valueTooltipExtension,
    includeDecorationExtension,
    branchAssumptionDecorationExtension,
    executionDecorationExtension,
    includeGraphRevisionExtension,
    ttlAutocompletion,
    themeCompartment.of(darkTheme),
    keymap.of([
      {
        key: 'Tab',
        run(view) {
          if (completionStatus(view.state) === 'active') return acceptCompletion(view)
          const pos = view.state.selection.main.head
          if (hasCompletionPrefix(view.state, pos)) {
            return startCompletion(view) || indentWithTab.run!(view)
          }
          return indentWithTab.run!(view)
        },
      },
      ...completionKeymap.filter((binding) => binding.key !== 'Tab'),
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onDocChange(update.state.doc.toString())
    }),
    EditorView.domEventHandlers({
      dragover(event) {
        if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')) {
          event.preventDefault()
          return true
        }
        return false
      },
      drop(event) {
        if (Array.from(event.dataTransfer?.files ?? []).some((f) => /\.(ttl|txt)$/i.test(f.name))) {
          event.preventDefault()
          return true
        }
        return false
      },
    }),
    editableCompartment.of(EditorView.editable.of(true)),
  ]
}

const darkTheme = EditorView.theme({
  '&': { backgroundColor: '#1e1e1e', color: '#d4d4d4' },
  '.cm-content': { fontFamily: "'Cascadia Code', 'Consolas', 'Meiryo UI', monospace", fontSize: '14px' },
  '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#858585', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: '#2a2a2a' },
  '.cm-activeLine': { backgroundColor: '#2a2a2a33' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#264f78' },
  '.cm-cursor': { borderLeftColor: '#aeafad' },
  '.cm-foldPlaceholder': { backgroundColor: '#3a3a3a', color: '#888' },
  '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#ccc' },
  '.cm-tooltip-lint': { backgroundColor: '#252526' },
}, { dark: true })

const lightTheme = EditorView.theme({
  '&': { backgroundColor: '#ebe9e5', color: '#3d3b39' },
  '.cm-content': { fontFamily: "'Cascadia Code', 'Consolas', 'Meiryo UI', monospace", fontSize: '14px' },
  '.cm-gutters': { backgroundColor: '#e3e1dd', color: '#8a8782', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: '#dbd9d4' },
  '.cm-activeLine': { backgroundColor: '#d8d6d133' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#a8c4dc88' },
  '.cm-cursor': { borderLeftColor: '#5a5854' },
  '.cm-foldPlaceholder': { backgroundColor: '#d0cdc7', color: '#8a8782' },
  '.cm-tooltip': { backgroundColor: '#dbd8d3', border: '1px solid #b8b4ad', color: '#3d3b39' },
  '.cm-tooltip-lint': { backgroundColor: '#dbd8d3' },
}, { dark: false })

export function createEditor(parent: HTMLElement, initialText = SAMPLE_MACRO): EditorInstance {
  let changeCallback: ((text: string) => void) | null = null

  const onDocChange = (text: string) => {
    if (changeCallback) changeCallback(text)
  }

  const createState = (doc = '') =>
    EditorState.create({ doc, extensions: buildExtensions(onDocChange) })

  const state = createState(initialText)
  const view = new EditorView({ state, parent })

  return {
    view,
    setTheme(dark: boolean) {
      view.dispatch({
        effects: themeCompartment.reconfigure(dark ? darkTheme : lightTheme),
      })
    },
    getValue: () => view.state.doc.toString(),
    setValue(text: string) {
      const current = view.state.doc.toString()
      if (text === current) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        userEvent: PROGRAM_REPLACE_USER_EVENT,
      })
    },
    getState: () => view.state,
    setState(state: EditorState) {
      view.setState(state)
    },
    createState,
    undo: () => undo(view),
    redo: () => redo(view),
    canUndo: () => undoDepth(view.state) > 0,
    canRedo: () => redoDepth(view.state) > 0,
    focus: () => view.focus(),
    onChange(callback) {
      changeCallback = callback
    },
    gotoLine(line: number) {
      const n = Math.max(1, Math.min(line, view.state.doc.lines))
      const lineObj = view.state.doc.line(n)
      view.dispatch({
        selection: { anchor: lineObj.from },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      })
      view.focus()
    },
    setIncludeDecorations(info: IncludeDecorationInfo | null) {
      applyIncludeDecorations(view, info)
    },
    setBranchAssumptionDecorations(assumptions) {
      applyBranchAssumptionDecorations(view, assumptions)
    },
    notifyIncludeGraphChanged() {
      bumpIncludeGraphRevision(view)
    },
    notifyAnalysisCacheChanged() {
      bumpAnalysisCacheRevision(view)
    },
    setExecutionLine(line: number | null, waiting = false) {
      applyExecutionLine(view, line, waiting)
    },
    clearExecutionLine() {
      clearExecutionLine(view)
    },
    setDryRunLocked(locked: boolean) {
      view.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(!locked)),
      })
    },
  }
}

export { SAMPLE_MACRO }
