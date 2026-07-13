import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'

interface ExecutionLinePayload {
  line: number | null
  waiting: boolean
}

const setExecutionLine = StateEffect.define<ExecutionLinePayload>()

const executionLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setExecutionLine)) {
        return buildExecutionDecoration(tr.state.doc, e.value.line, e.value.waiting)
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const executionLineDeco = Decoration.line({ class: 'cm-execution-line' })
const executionWaitingDeco = Decoration.line({ class: 'cm-execution-line cm-execution-waiting' })

function buildExecutionDecoration(
  doc: { line: (n: number) => { from: number; to: number } },
  lineNum: number | null,
  waiting = false,
): DecorationSet {
  if (!lineNum || lineNum < 1) return Decoration.none
  try {
    const line = doc.line(lineNum)
    const builder = new RangeSetBuilder<Decoration>()
    builder.add(line.from, line.from, waiting ? executionWaitingDeco : executionLineDeco)
    return builder.finish()
  } catch {
    return Decoration.none
  }
}

export const executionDecorationExtension: Extension = executionLineField

export function applyExecutionLine(view: EditorView, lineNum: number | null, waiting = false): void {
  view.dispatch({ effects: setExecutionLine.of({ line: lineNum, waiting }) })
  const editorEl = view.dom
  editorEl.classList.toggle('cm-dry-run-active', lineNum !== null)
  editorEl.classList.toggle('cm-dry-run-waiting', waiting)
}

export function clearExecutionLine(view: EditorView): void {
  applyExecutionLine(view, null, false)
}
