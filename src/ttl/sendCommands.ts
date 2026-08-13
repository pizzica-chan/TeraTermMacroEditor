/** 送信データパネル / ドライランで記録するホスト向け送信コマンド */

export const SEND_RECORD_COMMANDS = new Set([
  'send',
  'sendln',
  'sendbinary',
  'sendtext',
  'sendbroadcast',
  'sendlnbroadcast',
  'sendmulticast',
  'sendlnmulticast',
])

export type SendRecordCommand =
  | 'send'
  | 'sendln'
  | 'sendbinary'
  | 'sendtext'
  | 'sendbroadcast'
  | 'sendlnbroadcast'
  | 'sendmulticast'
  | 'sendlnmulticast'

const SEND_LN_COMMANDS = new Set<string>([
  'sendln',
  'sendlnbroadcast',
  'sendlnmulticast',
])

const SEND_MULTICAST_COMMANDS = new Set<string>(['sendmulticast', 'sendlnmulticast'])

export function isSendRecordCommand(cmd: string): cmd is SendRecordCommand {
  return SEND_RECORD_COMMANDS.has(cmd.toLowerCase())
}

export function sendAddsNewline(cmd: string): boolean {
  return SEND_LN_COMMANDS.has(cmd.toLowerCase())
}

/** データ引数の先頭トークン index（コマンド識別子の offset 基準） */
export function sendDataTokenStart(cmd: string, commandTokenOffset: number): number {
  if (SEND_MULTICAST_COMMANDS.has(cmd.toLowerCase())) return commandTokenOffset + 2
  return commandTokenOffset + 1
}
