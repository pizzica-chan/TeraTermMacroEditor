import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

export interface VariableAssumptionDecoration {
  line: number
  labels: string[]
}

const setVariableAssumptionDecorations =
  StateEffect.define<VariableAssumptionDecoration[] | null>()

class VariableAssumptionBadge extends WidgetType {
  private readonly labels: string[]

  constructor(labels: string[]) {
    super()
    this.labels = labels
  }

  eq(other: VariableAssumptionBadge): boolean {
    return this.labels.length === other.labels.length
      && this.labels.every((label, i) => label === other.labels[i])
  }

  toDOM(): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'cm-variable-assumption-badge'
    const shown = this.labels.slice(0, 2).join(', ')
    const extra = this.labels.length > 2 ? ` ほか${this.labels.length - 2}` : ''
    badge.textContent = `仮定: ${shown}${extra}`
    badge.title = `静的解析で使用するユーザー指定の変数仮定です。ドライランの実行値は変更しません。\n${this.labels.join('\n')}`
    return badge
  }

  ignoreEvent(): boolean {
    return true
  }
}

function buildDecorations(
  doc: { lines: number; line: (n: number) => { from: number; to: number } },
  assumptions: VariableAssumptionDecoration[] | null,
): DecorationSet {
  if (!assumptions?.length) return Decoration.none

  const builder = new RangeSetBuilder<Decoration>()
  for (const assumption of [...assumptions].sort((a, b) => a.line - b.line)) {
    if (assumption.line < 1 || assumption.line > doc.lines) continue
    if (assumption.labels.length === 0) continue
    const line = doc.line(assumption.line)
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: 'cm-variable-assumption-line',
      }),
    )
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new VariableAssumptionBadge(assumption.labels),
        side: 1,
      }),
    )
  }
  return builder.finish()
}

const variableAssumptionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setVariableAssumptionDecorations)) {
        return buildDecorations(tr.state.doc, effect.value)
      }
    }
    return decorations.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const variableAssumptionDecorationExtension: Extension = variableAssumptionField

export function applyVariableAssumptionDecorations(
  view: EditorView,
  assumptions: VariableAssumptionDecoration[] | null,
): void {
  view.dispatch({ effects: setVariableAssumptionDecorations.of(assumptions) })
}
