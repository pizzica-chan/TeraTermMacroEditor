import { history } from '@codemirror/commands'
import { Transaction, type Extension } from '@codemirror/state'

export const PROGRAM_REPLACE_USER_EVENT = 'program.replace'

/** 通常入力は1キーずつ、ペースト・全文置換・IME確定はまとめて Undo */
export function createEditorHistoryExtension(): Extension {
  return history({
    newGroupDelay: 0,
    joinToEvent(tr, isAdjacent) {
      const userEvent = tr.annotation(Transaction.userEvent)
      if (!userEvent) return false

      // キー入力は隣接していても結合しない（1文字ずつ戻す）
      if (/^input\.type($|\.)/.test(userEvent) && userEvent !== 'input.type.compose') {
        return false
      }

      // 単発の input（改行挿入など）も結合しない
      if (userEvent === 'input' || userEvent.startsWith('input.')) {
        return false
      }

      // Backspace / Delete も1操作ずつ
      if (/^delete($|\.)/.test(userEvent)) {
        return false
      }

      // ペースト・ドロップ・プログラム置換は単独イベントのまま
      if (
        userEvent === 'input.paste' ||
        userEvent === 'input.drop' ||
        userEvent === PROGRAM_REPLACE_USER_EVENT
      ) {
        return false
      }

      return isAdjacent
    },
  })
}
