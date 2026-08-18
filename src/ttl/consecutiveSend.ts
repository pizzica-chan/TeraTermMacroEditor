/**
 * 連続する send / sendln の間に wait 系・ダイアログがないときの警告（行先頭コマンドの並びのみ）。
 * - 対象は send と sendln のみ（sendbroadcast 等は見ない）
 * - wait 系は受信待ち（flushrecv チェックと同じ集合）。statusbox は非モーダルなのでダイアログに含めない
 * - 区間は end / exit / return / call / include で区切る
 *   （call / include 先で wait している場合の誤警告を避ける。goto / if は区切りにしない）
 */
import { lineKeyword } from './controlFlow'
import { tokenizeLine } from './tokenize'

export const CONSECUTIVE_SEND_DIAG_CODE = 'consecutive-send'

export interface ConsecutiveSendDiagnostic {
  line: number
  column: number
  endColumn: number
  message: string
  severity: 'warning'
  code: typeof CONSECUTIVE_SEND_DIAG_CODE
}

const SEND_COMMANDS = new Set(['send', 'sendln'])

/** 受信を待つコマンド。waitevent はホスト応答待ちではないので含めない */
const WAIT_COMMANDS = new Set([
  'wait',
  'waitln',
  'waitregex',
  'wait4all',
  'waitrecv',
  'waitn',
  'recvln',
])

/** 操作を止めるダイアログ（公式 messagebox 等）。statusbox は閉じるまで進むので対象外 */
const DIALOG_COMMANDS = new Set([
  'messagebox',
  'yesnobox',
  'inputbox',
  'passwordbox',
  'listbox',
  'filenamebox',
  'dirnamebox',
])

function lineCommandColumn(line: string, lineIdx: number): number {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  const tok = tokens[off]
  return tok?.kind === 'identifier' ? tok.column : 0
}

function lineCommandEndColumn(line: string, lineIdx: number): number {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  const tok = tokens[off]
  return tok ? tok.column + tok.text.length : 0
}

function isSendCommand(cmd: string): boolean {
  return SEND_COMMANDS.has(cmd.toLowerCase())
}

function isWaitCommand(cmd: string): boolean {
  return WAIT_COMMANDS.has(cmd.toLowerCase())
}

function isDialogCommand(cmd: string): boolean {
  return DIALOG_COMMANDS.has(cmd.toLowerCase())
}

function isSequenceBoundary(cmd: string): boolean {
  return cmd === 'end' || cmd === 'exit' || cmd === 'return' || cmd === 'call' || cmd === 'include'
}

export function buildConsecutiveSendMessage(cmd: string): string {
  const key = cmd.toLowerCase()
  return `'${key}' の前に wait またはダイアログがありません。連続する send / sendln の間には wait 系または messagebox 等を置くことを検討してください`
}

export function collectConsecutiveSendDiagnostics(lines: string[]): ConsecutiveSendDiagnostic[] {
  const diags: ConsecutiveSendDiagnostic[] = []
  let pendingSend = false

  for (let i = 0; i < lines.length; i++) {
    const cmd = lineKeyword(lines[i]!, i)
    if (!cmd) continue
    if (isSequenceBoundary(cmd) || isWaitCommand(cmd) || isDialogCommand(cmd)) {
      pendingSend = false
      continue
    }
    if (!isSendCommand(cmd)) continue
    if (pendingSend) {
      diags.push({
        line: i + 1,
        column: lineCommandColumn(lines[i]!, i),
        endColumn: lineCommandEndColumn(lines[i]!, i),
        message: buildConsecutiveSendMessage(cmd),
        severity: 'warning',
        code: CONSECUTIVE_SEND_DIAG_CODE,
      })
    }
    pendingSend = true
  }

  return diags
}
