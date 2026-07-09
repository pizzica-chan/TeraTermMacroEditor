import { StateField } from '@codemirror/state'
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view'
import { evaluateTTL, type EvaluationResult } from './evaluator'
import { getIncludeResolver, includeGraphRevisionField } from './analysisContext'
import { tokenizeLine } from './tokenize'

function buildEvaluation(doc: string): EvaluationResult {
  return evaluateTTL(doc, { includeResolver: getIncludeResolver() })
}

const evalField = StateField.define<EvaluationResult>({
  create(state) {
    return buildEvaluation(state.doc.toString())
  },
  update(value, tr) {
    const revisionChanged =
      tr.startState.field(includeGraphRevisionField) !== tr.state.field(includeGraphRevisionField)
    if (tr.docChanged || revisionChanged) {
      return buildEvaluation(tr.state.doc.toString())
    }
    return value
  },
})

function createTooltipDom(info: {
  name: string
  type: string
  display: string
  note?: string
  valueKind?: 'known' | 'runtime' | 'system-default' | 'unset'
  isSystem?: boolean
}): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-var-tooltip'

  const header = document.createElement('div')
  header.className = 'cm-var-tooltip-header'
  const typeLabel = info.isSystem ? `${info.type} · system` : info.type
  header.innerHTML = `<span class="cm-var-name">${escapeHtml(info.name)}</span><span class="cm-var-type${info.isSystem ? ' system' : ''}">${escapeHtml(typeLabel)}</span>`
  dom.appendChild(header)

  const value = document.createElement('div')
  value.className = `cm-var-tooltip-value${info.valueKind ? ` value-${info.valueKind}` : ''}`
  value.textContent = info.display
  dom.appendChild(value)

  if (info.note) {
    const note = document.createElement('div')
    note.className = 'cm-var-tooltip-note'
    note.textContent = info.note
    dom.appendChild(note)
  }

  return dom
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function findTokenRange(line: string, lineNum: number, column: number): { from: number; to: number } {
  const tokens = tokenizeLine(line, lineNum)
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    if (tok.kind !== 'identifier') continue
    const start = tok.column
    const end = tok.column + tok.text.length
    if (column >= start && column < end) {
      if (tokens[i + 1]?.text === '[' && tokens[i + 3]?.text === ']') {
        return { from: start, to: tokens[i + 3]!.column + 1 }
      }
      return { from: start, to: end }
    }
    if (i > 0 && tokens[i - 1]?.text === '[' && tokens[i + 1]?.text === ']' && column >= start && column < end) {
      return { from: tokens[i - 2]?.column ?? start, to: tokens[i + 1]!.column + 1 }
    }
  }
  return { from: column, to: column + 1 }
}

const varHoverTooltip = hoverTooltip(
  (view: EditorView, pos: number): Tooltip | null => {
    const evalResult = view.state.field(evalField, false)
    if (!evalResult) return null

    const line = view.state.doc.lineAt(pos)
    const column = pos - line.from
    const info = evalResult.getHoverInfo(line.number, column)
    if (!info) return null

    const range = findTokenRange(line.text, line.number, column)

    return {
      pos: line.from + range.from,
      end: line.from + range.to,
      above: true,
      create() {
        return { dom: createTooltipDom(info) }
      },
    }
  },
  { hoverTime: 400 },
)

export const valueTooltipExtension = [evalField, varHoverTooltip]
