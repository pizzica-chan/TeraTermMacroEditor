/**
 * flushrecv → send/sendln → wait 系の順序チェック（行先頭コマンドの並びのみ）。
 * - flushrecv の後に wait 系があるとき、その flushrecv より前の send で flushrecv なしのものを警告
 * - flushrecv と wait 系の間に send 系が 2 つ以上あり、2 つ目以降の send の前に flushrecv がないときも警告
 * - 区間は wait 系または end / exit / return で区切る
 */
import { lineKeyword } from './controlFlow'
import { isSendRecordCommand } from './sendCommands'
import { tokenizeLine } from './tokenize'

export const FLUSHRECV_BEFORE_SEND_DIAG_CODE = 'flushrecv-before-send'

export interface FlushrecvBeforeSendDiagnostic {
  line: number
  column: number
  endColumn: number
  message: string
  severity: 'warning'
  code: typeof FLUSHRECV_BEFORE_SEND_DIAG_CODE
}

/** 受信バッファを読むコマンド（公式 flushrecv の対象）。waitevent はイベント待ちなので含めない */
const WAIT_COMMANDS = new Set([
  'wait',
  'waitln',
  'waitregex',
  'wait4all',
  'waitrecv',
  'waitn',
  'recvln',
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

function isWaitCommand(cmd: string): boolean {
  return WAIT_COMMANDS.has(cmd.toLowerCase())
}

/** マクロ終了・サブルーチン復帰。これより先（または前）は別区間 */
function isSequenceBoundary(cmd: string): boolean {
  return cmd === 'end' || cmd === 'exit' || cmd === 'return'
}

/** send 行の直前に flushrecv があるか（直前の wait 系・別 send・区間境界まで遡る） */
export function hasFlushrecvBeforeSend(lines: string[], sendLineIdx: number): boolean {
  for (let k = sendLineIdx - 1; k >= 0; k--) {
    const cmd = lineKeyword(lines[k]!, k)
    if (!cmd) continue
    if (cmd === 'flushrecv') return true
    if (isWaitCommand(cmd) || isSendRecordCommand(cmd) || isSequenceBoundary(cmd)) return false
  }
  return false
}

/** flushrecv の後に send なしで wait が来るか */
export function isFlushrecvFollowedByWaitWithoutSend(lines: string[], flushrecvIdx: number): boolean {
  const { waitIdx, sendIndices } = scanSendsBetweenFlushrecvAndWait(lines, flushrecvIdx)
  return waitIdx !== null && sendIndices.length === 0
}

interface FlushrecvWaitScan {
  waitIdx: number | null
  sendIndices: number[]
}

/** flushrecv の直後から wait までの send 行 index（0-based）を収集する */
export function scanSendsBetweenFlushrecvAndWait(
  lines: string[],
  flushrecvIdx: number,
): FlushrecvWaitScan {
  const sendIndices: number[] = []
  for (let j = flushrecvIdx + 1; j < lines.length; j++) {
    const cmd = lineKeyword(lines[j]!, j)
    if (!cmd) continue
    if (isSendRecordCommand(cmd)) {
      sendIndices.push(j)
      continue
    }
    if (isWaitCommand(cmd)) return { waitIdx: j, sendIndices }
    if (isSequenceBoundary(cmd)) return { waitIdx: null, sendIndices }
  }
  return { waitIdx: null, sendIndices }
}

export function buildFlushrecvBeforeSendMessage(cmd: string): string {
  const key = cmd.toLowerCase()
  return `'${key}' の前に flushrecv がありません。wait の前は flushrecv → ${key} → wait の順にすることを検討してください`
}

function pushSendWithoutFlushrecvWarning(
  lines: string[],
  sendLineIdx: number,
  warnedLines: Set<number>,
  diags: FlushrecvBeforeSendDiagnostic[],
): void {
  if (warnedLines.has(sendLineIdx)) return
  const bwdCmd = lineKeyword(lines[sendLineIdx]!, sendLineIdx)
  if (!bwdCmd || !isSendRecordCommand(bwdCmd)) return
  if (hasFlushrecvBeforeSend(lines, sendLineIdx)) return

  warnedLines.add(sendLineIdx)
  const lineNum = sendLineIdx + 1
  diags.push({
    line: lineNum,
    column: lineCommandColumn(lines[sendLineIdx]!, sendLineIdx),
    endColumn: lineCommandEndColumn(lines[sendLineIdx]!, sendLineIdx),
    message: buildFlushrecvBeforeSendMessage(bwdCmd),
    severity: 'warning',
    code: FLUSHRECV_BEFORE_SEND_DIAG_CODE,
  })
}

function warnSendsBeforeFlushrecvWithoutFlushrecv(
  lines: string[],
  flushrecvIdx: number,
  warnedLines: Set<number>,
  diags: FlushrecvBeforeSendDiagnostic[],
): void {
  for (let k = flushrecvIdx - 1; k >= 0; k--) {
    const bwdCmd = lineKeyword(lines[k]!, k)
    if (!bwdCmd) continue
    if (isWaitCommand(bwdCmd) || isSequenceBoundary(bwdCmd)) break
    if (bwdCmd === 'flushrecv') continue
    if (!isSendRecordCommand(bwdCmd)) continue
    pushSendWithoutFlushrecvWarning(lines, k, warnedLines, diags)
  }
}

export function collectFlushrecvBeforeSendDiagnostics(lines: string[]): FlushrecvBeforeSendDiagnostic[] {
  const diags: FlushrecvBeforeSendDiagnostic[] = []
  const warnedLines = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    const cmd = lineKeyword(lines[i]!, i)
    if (cmd !== 'flushrecv') continue

    const { waitIdx, sendIndices } = scanSendsBetweenFlushrecvAndWait(lines, i)
    if (waitIdx === null) continue

    warnSendsBeforeFlushrecvWithoutFlushrecv(lines, i, warnedLines, diags)

    if (sendIndices.length >= 2) {
      for (const sendIdx of sendIndices.slice(1)) {
        pushSendWithoutFlushrecvWarning(lines, sendIdx, warnedLines, diags)
      }
    }
  }

  return diags
}
