import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import type { IncludeRef } from '../ttl/includeRefs'
import { normalizeIncludePath } from '../ttl/includeRefs'

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
    if (ref.isDynamic || !ref.path) continue
    try {
      const line = doc.line(ref.line)
      const key = normalizeIncludePath(ref.path)
      const linkedTabId = info.bindings[key]
      const deco = linkedTabId ? linkedLine : unlinkedLine
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
  if (!ref.path) return 'include（動的パス）'
  const key = normalizeIncludePath(ref.path)
  const tabId = bindings[key]
  if (!tabId) return `include '${ref.path}'（未リンク）`
  const tabName = tabNames[tabId] ?? tabId
  return `include '${ref.path}' → ${tabName}`
}
