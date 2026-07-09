import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import {
  getIncludeBindingKey,
  getLoopIncludeCommonTabId,
  includeLoopIterationBindingKey,
  isIncludeRefLinked,
  resolveIncludeBindingTabId,
  type IncludeRef,
} from '../ttl/includeRefs'

export interface IncludeDecorationInfo {
  refs: IncludeRef[]
  bindings: Record<string, string>
  tabNames: Record<string, string>
}

const setIncludeDecorations = StateEffect.define<IncludeDecorationInfo | null>()

const includeField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setIncludeDecorations)) {
        return buildDecorations(tr.state.doc, e.value)
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const linkedLine = Decoration.line({ class: 'cm-include-linked' })
const unlinkedLine = Decoration.line({ class: 'cm-include-unlinked' })

function buildDecorations(doc: { line: (n: number) => { from: number; to: number } }, info: IncludeDecorationInfo | null): DecorationSet {
  if (!info || info.refs.length === 0) return Decoration.none

  const builder = new RangeSetBuilder<Decoration>()
  for (const ref of info.refs) {
    if (!ref.path && !ref.isDynamic) continue
    try {
      const line = doc.line(ref.line)
      const linked = isIncludeRefLinked(ref, info.bindings)
      const deco = linked ? linkedLine : unlinkedLine
      builder.add(line.from, line.from, deco)
    } catch {
      // 行番号が範囲外
    }
  }
  return builder.finish()
}

export const includeDecorationExtension: Extension = includeField

export function applyIncludeDecorations(view: EditorView, info: IncludeDecorationInfo | null): void {
  view.dispatch({ effects: setIncludeDecorations.of(info) })
}

export function getIncludeLineTitle(ref: IncludeRef, bindings: Record<string, string>, tabNames: Record<string, string>): string {
  if (!ref.path && !ref.isDynamic) return 'include（引数なし）'

  if (ref.loopContext) {
    const commonTabId = getLoopIncludeCommonTabId(ref, bindings)
    if (commonTabId) {
      const tabName = tabNames[commonTabId] ?? commonTabId
      return `include ${ref.raw} → ${tabName}（全反復共通）`
    }
    const linked = ref.loopContext.values
      .map((v) => {
        const key = includeLoopIterationBindingKey(ref.line, v)
        const tabId = resolveIncludeBindingTabId(bindings, key, ref.raw)
        const tabName = tabId ? (tabNames[tabId] ?? tabId) : '未リンク'
        return `${ref.loopContext!.variable}=${v}→${tabName}`
      })
      .join(', ')
    return `include ${ref.raw}（ループ展開: ${linked}）`
  }

  const key = getIncludeBindingKey(ref)
  if (!key) return 'include（引数なし）'

  const tabId = bindings[key]
  const tabName = tabId ? (tabNames[tabId] ?? tabId) : null

  if (ref.path) {
    if (!tabId) return `include '${ref.path}'（未リンク）`
    return `include '${ref.path}' → ${tabName}`
  }

  const argLabel = ref.raw || '（変数）'
  if (!tabId) return `include ${argLabel}（未リンク・変数指定）`
  return `include ${argLabel} → ${tabName}（手動リンク）`
}
