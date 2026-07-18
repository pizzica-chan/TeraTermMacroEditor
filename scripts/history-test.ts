/** エディタ Undo 履歴の挙動検証 */
import { EditorState, Transaction } from '@codemirror/state'
import { undo, undoDepth } from '@codemirror/commands'
import { createEditorHistoryExtension, PROGRAM_REPLACE_USER_EVENT } from '../src/editor/editorHistory'

let passed = 0
let failed = 0

function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  OK  ${label}`)
  } else {
    failed++
    console.log(`  NG  ${label}`, detail ?? '')
  }
}

function mkState(doc = '') {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length, head: doc.length },
    extensions: [createEditorHistoryExtension()],
  })
}

function insertAtEnd(state: EditorState): number {
  return state.doc.length
}

function typeChar(state: EditorState, ch: string, time: number): EditorState {
  const pos = insertAtEnd(state)
  return state.update({
    changes: { from: pos, insert: ch },
    selection: { anchor: pos + ch.length },
    userEvent: 'input.type',
    annotations: [Transaction.time.of(time)],
  }).state
}

function pasteText(state: EditorState, text: string, time: number): EditorState {
  const pos = insertAtEnd(state)
  return state.update({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: 'input.paste',
    annotations: [Transaction.time.of(time)],
  }).state
}

function composeText(state: EditorState, text: string, time: number): EditorState {
  const pos = insertAtEnd(state)
  return state.update({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: 'input.type.compose',
    annotations: [Transaction.time.of(time)],
  }).state
}

function programReplace(state: EditorState, text: string, time: number): EditorState {
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: PROGRAM_REPLACE_USER_EVENT,
    annotations: [Transaction.time.of(time)],
  }).state
}

function runUndo(state: EditorState): EditorState {
  let next = state
  const done = undo({
    state,
    dispatch(tr) {
      next = tr.state
    },
  })
  if (!done) throw new Error('undo failed')
  return next
}

console.log('=== 1. typing: one undo removes one character ===')
{
  let state = mkState('')
  for (let i = 0; i < 5; i++) state = typeChar(state, String(i), 1000 + i * 100)
  assert(state.doc.toString() === '01234', 'typed 5 chars', state.doc.toString())
  assert(undoDepth(state) === 5, 'undo depth is 5', undoDepth(state))
  state = runUndo(state)
  assert(state.doc.toString() === '0123', 'one undo removes last char', state.doc.toString())
}

console.log('\n=== 2. paste: one undo removes entire paste ===')
{
  let state = mkState('ab')
  state = pasteText(state, 'XYZ', 2000)
  assert(state.doc.toString() === 'abXYZ', 'pasted', state.doc.toString())
  state = runUndo(state)
  assert(state.doc.toString() === 'ab', 'one undo removes paste', state.doc.toString())
}

console.log('\n=== 3. program replace: one undo restores previous document ===')
{
  let state = mkState('before')
  state = programReplace(state, 'after', 3000)
  assert(state.doc.toString() === 'after', 'replaced', state.doc.toString())
  state = runUndo(state)
  assert(state.doc.toString() === 'before', 'one undo restores before', state.doc.toString())
}

console.log('\n=== 4. IME compose: one undo removes composed chunk ===')
{
  let state = mkState('')
  state = composeText(state, 'あ', 4000)
  state = composeText(state, 'い', 4100)
  assert(state.doc.toString() === 'あい', 'composed', state.doc.toString())
  const depthBefore = undoDepth(state)
  state = runUndo(state)
  assert(state.doc.toString() === '', 'compose undo clears chunk', state.doc.toString())
  assert(depthBefore <= 2, 'compose uses at most 2 history entries', depthBefore)
}

console.log('\n=== 5. typing then paste: undo removes paste only ===')
{
  let state = mkState('')
  state = typeChar(state, 'x', 5000)
  state = typeChar(state, 'y', 5100)
  state = pasteText(state, 'PASTE', 5200)
  assert(state.doc.toString() === 'xyPASTE', 'typed then pasted', state.doc.toString())
  state = runUndo(state)
  assert(state.doc.toString() === 'xy', 'undo removes paste only', state.doc.toString())
}

console.log(`\n=== HISTORY TEST RESULT: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
