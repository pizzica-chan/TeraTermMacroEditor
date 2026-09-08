import { StateField, RangeSetBuilder, type Extension, type EditorState } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { collectBlockRanges, type BlockRange } from '../ttl/controlFlow'

let cache: { source: string; ranges: BlockRange[] } | null = null

function getCachedBlockRanges(source: string): BlockRange[] {
  if (cache && cache.source === source) return cache.ranges
  const ranges = collectBlockRanges(source)
  cache = { source, ranges }
  return ranges
}

function findActiveRange(ranges: BlockRange[], cursorLine: number): BlockRange | undefined {
  return ranges.find(
    (r) => r.startLine === cursorLine || r.endLine === cursorLine || r.branchLines.includes(cursorLine),
  )
}

const nestLineDeco = Decoration.line({ class: 'cm-block-nest-line' })

function buildBlockNestDecorations(state: EditorState): DecorationSet {
  const cursorLine = state.doc.lineAt(state.selection.main.head).number
  const ranges = getCachedBlockRanges(state.doc.toString())
  const active = findActiveRange(ranges, cursorLine)
  if (!active) return Decoration.none

  const builder = new RangeSetBuilder<Decoration>()
  const lastLine = Math.min(active.endLine, state.doc.lines)
  for (let lineNum = active.startLine; lineNum <= lastLine; lineNum++) {
    builder.add(state.doc.line(lineNum).from, state.doc.line(lineNum).from, nestLineDeco)
  }
  return builder.finish()
}

const blockNestRangeField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockNestDecorations(state)
  },
  update(deco, tr) {
    if (tr.docChanged || !tr.startState.selection.eq(tr.state.selection)) {
      return buildBlockNestDecorations(tr.state)
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * if/while/for/do/until のキーワード行（elseif/else/endif 等の対応行を含む）に
 * カーソルがあるとき、そのブロックの開始行〜終了行に縦ガイドラインを表示する。
 * カーソル位置から純粋に計算するため、他の decoration と違い外部からの
 * apply/clear 呼び出しは不要（selectionSet/docChanged で自動更新）。
 */
export const blockNestRangeExtension: Extension = blockNestRangeField
