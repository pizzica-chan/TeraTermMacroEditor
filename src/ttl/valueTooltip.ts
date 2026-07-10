import { StateField } from '@codemirror/state'
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view'
import type { EvaluationResult } from './evaluator'
import {
  analysisCacheRevisionField,
  getCachedEvaluation,
  includeGraphRevisionField,
} from './analysisContext'

const emptyEvaluation: EvaluationResult = {
  beforeLine: new Map(),
  afterLine: new Map(),
  sendEntries: [],
  getHoverAt: () => null,
}

const evalField = StateField.define<EvaluationResult>({
  create(state) {
    return getCachedEvaluation(state.doc.toString()) ?? emptyEvaluation
  },
  update(value, tr) {
    const revisionChanged =
      tr.startState.field(includeGraphRevisionField) !== tr.state.field(includeGraphRevisionField) ||
      tr.startState.field(analysisCacheRevisionField) !== tr.state.field(analysisCacheRevisionField)
    if (tr.docChanged || revisionChanged) {
      return getCachedEvaluation(tr.state.doc.toString()) ?? emptyEvaluation
    }
    return value
  },
})

function createTooltipDom(info: {
  name: string
  type: string
  display: string
  note?: string
  valueKind?: 'known' | 'runtime' | 'system-default' | 'unset' | 'label'
  isSystem?: boolean
}): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-var-tooltip'

  const header = document.createElement('div')
  header.className = 'cm-var-tooltip-header'
  const isLabel = info.valueKind === 'label'
  const typeLabel = isLabel ? 'label' : info.isSystem ? `${info.type} · system` : info.type
  header.innerHTML = `<span class="cm-var-name">${escapeHtml(info.name)}</span><span class="cm-var-type${info.isSystem ? ' system' : ''}${isLabel ? ' label' : ''}">${escapeHtml(typeLabel)}</span>`
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

const varHoverTooltip = hoverTooltip(
  (view: EditorView, pos: number): Tooltip | null => {
    const evalResult = view.state.field(evalField, false)
    if (!evalResult) return null

    const line = view.state.doc.lineAt(pos)
    const column = pos - line.from
    const hover = evalResult.getHoverAt(line.number, column)
    if (!hover) return null

    return {
      pos: line.from + hover.from,
      end: line.from + hover.to,
      above: true,
      create() {
        return { dom: createTooltipDom(hover.info) }
      },
    }
  },
  { hoverTime: 400 },
)

export const valueTooltipExtension = [evalField, varHoverTooltip]
