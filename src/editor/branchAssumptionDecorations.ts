import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

export interface BranchAssumptionDecoration {
  line: number
  value: boolean
}

const setBranchAssumptionDecorations =
  StateEffect.define<BranchAssumptionDecoration[] | null>()

class AssumptionBadge extends WidgetType {
  private readonly value: boolean

  constructor(value: boolean) {
    super()
    this.value = value
  }

  eq(other: AssumptionBadge): boolean {
    return this.value === other.value
  }

  toDOM(): HTMLElement {
    const badge = document.createElement('span')
    badge.className = `cm-branch-assumption-badge ${this.value ? 'true' : 'false'}`
    badge.textContent = `仮定: ${this.value ? 'TRUE' : 'FALSE'}`
    badge.title = '静的解析で使用するユーザー指定の分岐仮定です。ドライランの実行条件は変更しません。'
    return badge
  }

  ignoreEvent(): boolean {
    return true
  }
}

function buildDecorations(
  doc: { lines: number; line: (n: number) => { from: number; to: number } },
  assumptions: BranchAssumptionDecoration[] | null,
): DecorationSet {
  if (!assumptions?.length) return Decoration.none

  const builder = new RangeSetBuilder<Decoration>()
  for (const assumption of [...assumptions].sort((a, b) => a.line - b.line)) {
    if (assumption.line < 1 || assumption.line > doc.lines) continue
    const line = doc.line(assumption.line)
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: `cm-branch-assumption-line ${assumption.value ? 'true' : 'false'}`,
      }),
    )
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new AssumptionBadge(assumption.value),
        side: 1,
      }),
    )
  }
  return builder.finish()
}

const branchAssumptionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBranchAssumptionDecorations)) {
        return buildDecorations(tr.state.doc, effect.value)
      }
    }
    return decorations.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const branchAssumptionDecorationExtension: Extension = branchAssumptionField

export function applyBranchAssumptionDecorations(
  view: EditorView,
  assumptions: BranchAssumptionDecoration[] | null,
): void {
  view.dispatch({ effects: setBranchAssumptionDecorations.of(assumptions) })
}
