import { StateField } from '@codemirror/state'
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view'
import type { EvaluationResult } from './evaluator'
import {
  findCommandHoverTarget,
  getCommandHint,
  type CommandHint,
} from './commandHints'
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
  valueKind?: 'known' | 'runtime' | 'system-default' | 'unset' | 'label' | 'assumed'
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

function kindLabel(kind: CommandHint['kind']): string {
  switch (kind) {
    case 'keyword':
      return 'キーワード'
    case 'operator':
      return '演算子'
    default:
      return 'コマンド'
  }
}

function createCommandTooltipDom(hint: CommandHint): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-cmd-tooltip'

  const header = document.createElement('div')
  header.className = 'cm-cmd-tooltip-header'
  header.innerHTML =
    `<span class="cm-cmd-name">${escapeHtml(hint.name)}</span>`
    + `<span class="cm-cmd-kind">${escapeHtml(kindLabel(hint.kind))}</span>`
  dom.appendChild(header)

  const summary = document.createElement('div')
  summary.className = 'cm-cmd-tooltip-summary'
  summary.textContent = hint.summary
  dom.appendChild(summary)

  const usage = document.createElement('div')
  usage.className = 'cm-cmd-tooltip-usage'
  const code = document.createElement('code')
  code.textContent = hint.usage
  usage.appendChild(code)
  dom.appendChild(usage)

  if (hint.note) {
    const note = document.createElement('div')
    note.className = 'cm-cmd-tooltip-note'
    note.textContent = hint.note
    dom.appendChild(note)
  }

  if (hint.manualUrl) {
    const link = document.createElement('a')
    link.className = 'cm-cmd-tooltip-manual'
    link.href = hint.manualUrl
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = '公式マニュアル'
    link.addEventListener('mousedown', (e) => e.stopPropagation())
    link.addEventListener('click', (e) => {
      e.stopPropagation()
      // file:// 配布では通常の遷移がブロックされることがある
      if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        window.open(hint.manualUrl, '_blank', 'noopener,noreferrer')
      }
    })
    dom.appendChild(link)
  }

  return dom
}

const varHoverTooltip = hoverTooltip(
  (view: EditorView, pos: number): Tooltip | null => {
    const line = view.state.doc.lineAt(pos)
    const column = pos - line.from

    const cmdTarget = findCommandHoverTarget(line.text, line.number, column)
    if (cmdTarget) {
      const hint = getCommandHint(cmdTarget.cmd)
      if (hint) {
        return {
          pos: line.from + cmdTarget.from,
          end: line.from + cmdTarget.to,
          above: true,
          create() {
            return { dom: createCommandTooltipDom(hint) }
          },
        }
      }
    }

    // include のリンク変更や非同期解析の完了直後は StateField のスナップショットが
    // 一時的に古い場合があるため、現在の文書に対応する最新キャッシュを優先する。
    const evalResult =
      getCachedEvaluation(view.state.doc.toString()) ??
      view.state.field(evalField, false)
    if (!evalResult) return null

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
