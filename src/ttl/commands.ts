/** TTL コマンド・キーワード・システム変数の定義 */

import { COMMAND_OUTPUT_EFFECTS } from './commandOutputs'
import {
  getParamcntMeta,
  getParamNMeta,
  getParamsArrayMeta,
} from './commandLineParams'

export const CONTROL_KEYWORDS = new Set([
  'if', 'then', 'elseif', 'else', 'endif',
  'for', 'next',
  'while', 'endwhile',
  'do', 'loop',
  'until', 'enduntil',
  'goto', 'call', 'return',
  'break', 'continue',
  'end', 'exit',
  'include',
  'pause', 'mpause',
])

export const TTL_COMMANDS = new Set([
  // Communication
  'bplusrecv', 'bplussend', 'callmenu', 'changedir', 'clearscreen', 'closett',
  'connect', 'cygconnect', 'disconnect', 'dispstr', 'enablekeyb', 'flushrecv',
  'gethostname', 'getmodemstatus', 'gettitle', 'getttpos', 'kmtfinish', 'kmtget',
  'kmtrecv', 'kmtsend', 'loadkeymap', 'logautoclosemode', 'logclose', 'loginfo',
  'logopen', 'logpause', 'logrotate', 'logstart', 'logwrite', 'quickvanrecv',
  'quickvansend', 'recvln', 'recvfile', 'restoresetup', 'scprecv', 'scpsend',
  'send', 'sendbinary', 'sendbreak', 'sendbroadcast', 'sendfile', 'sendkcode',
  'sendln', 'sendlnbroadcast', 'sendlnmulticast', 'sendtext', 'sendmulticast',
  'setbaud', 'setdebug', 'setdtr', 'setecho', 'setflowctrl', 'setmulticastname',
  'setrts', 'setserialdelaychar', 'setserialdelayline', 'setspeed', 'setsync',
  'settitle', 'showtt', 'testlink', 'unlink', 'wait', 'wait4all', 'waitevent',
  'waitln', 'waitn', 'waitrecv', 'waitregex', 'xmodemrecv', 'xmodemsend',
  'ymodemrecv', 'ymodemsend', 'zmodemrecv', 'zmodemsend',
  // Control
  'break', 'call', 'continue', 'do', 'end', 'execcmnd', 'exit', 'for', 'goto',
  'if', 'include', 'mpause', 'next', 'pause', 'return', 'until', 'while',
  // String
  'code2str', 'expandenv', 'int2str', 'regexoption', 'sprintf', 'sprintf2',
  'str2code', 'str2int', 'strcompare', 'strconcat', 'strcopy', 'strinsert',
  'strjoin', 'strlength', 'strmatch', 'strremove', 'strreplace', 'strscan',
  'strspecial', 'strsplit', 'strtrim', 'tolower', 'toupper', 'strlen',
  // File
  'basename', 'dirname', 'dirnamebox', 'exec', 'fileclose', 'fileconcat', 'filecopy', 'filecreate',
  'filedelete', 'filelock', 'filemarkptr', 'fileopen', 'filenamebox', 'fileread', 'filereadln', 'filerename',
  'filesearch', 'fileseek', 'fileseekback', 'filestat', 'filestrseek',
  'filestrseek2', 'filetruncate', 'fileunlock', 'filewrite', 'filewriteln',
  'findclose', 'findfirst', 'findnext', 'foldercreate', 'folderdelete',
  'foldersearch', 'getdir', 'getfileattr', 'makepath', 'setdir', 'setfileattr',
  // Password
  'delpassword', 'delpassword2', 'getpassword', 'getpassword2', 'ispassword',
  'ispassword2', 'passwordbox', 'setpassword', 'setpassword2',
  // Misc
  'beep', 'bringupbox', 'checksum8', 'checksum8file', 'checksum16', 'checksum16file',
  'checksum32', 'checksum32file', 'closesbox', 'clipb2var', 'crc16', 'crc16file',
  'crc32', 'crc32file', 'dirnamebox', 'filenamebox', 'getdate', 'getenv',
  'getipv4addr', 'getipv6addr', 'getspecialfolder', 'gettime', 'getttdir',
  'getver', 'ifdefined', 'inputbox', 'intdim', 'listbox', 'messagebox',
  'random', 'rotateleft', 'rotateright', 'setdate', 'setdlgpos', 'setenv',
  'setexitcode', 'settime', 'show', 'statusbox', 'strdim', 'uptime',
  'var2clipb', 'yesnobox',
])

/** 単語として書けるビット演算子（公式: and/or/xor/not はビット演算であり論理演算ではない） */
export const LOGICAL_OPERATORS = new Set(['and', 'or', 'xor', 'not'])

export {
  getCommandOutputEffect,
  getOutputVariableIndices,
  getOutputVariableType,
  isArg1OutputCommand,
} from './commandOutputs'

/** 第1引数が出力変数のコマンド（後方互換） */
export const OUTPUT_COMMANDS = new Set(
  Object.entries(COMMAND_OUTPUT_EFFECTS)
    .filter(([, effect]) => effect.variables?.some((v) => v.index === 1))
    .map(([cmd]) => cmd),
)

/** システム変数（型付き） */
export const SYSTEM_VARIABLES: Record<string, 'integer' | 'string' | 'array'> = {
  timeout: 'integer',
  mtimeout: 'integer',
  result: 'integer',
  inputstr: 'string',
  matchstr: 'string',
  paramcnt: 'integer',
  param1: 'string',
  param2: 'string',
  param3: 'string',
  param4: 'string',
  param5: 'string',
  param6: 'string',
  param7: 'string',
  param8: 'string',
  param9: 'string',
  params: 'array',
  groupmatchstr1: 'string',
  groupmatchstr2: 'string',
  groupmatchstr3: 'string',
  groupmatchstr4: 'string',
  groupmatchstr5: 'string',
  groupmatchstr6: 'string',
  groupmatchstr7: 'string',
  groupmatchstr8: 'string',
  groupmatchstr9: 'string',
}

export function isCommand(word: string): boolean {
  return TTL_COMMANDS.has(word.toLowerCase())
}

export function isKeyword(word: string): boolean {
  const lower = word.toLowerCase()
  return CONTROL_KEYWORDS.has(lower) || LOGICAL_OPERATORS.has(lower)
}

export function isSystemVariable(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower in SYSTEM_VARIABLES) return true
  if (/^groupmatchstr\d+$/.test(lower)) return true
  if (/^param\d+$/.test(lower)) return true
  return false
}

export function getSystemVariableType(name: string): 'integer' | 'string' | 'array' | undefined {
  const lower = name.toLowerCase()
  if (lower in SYSTEM_VARIABLES) return SYSTEM_VARIABLES[lower]
  if (/^groupmatchstr\d+$/.test(lower)) return 'string'
  if (/^param\d+$/.test(lower)) return 'string'
  return undefined
}

export interface SystemVariableMeta {
  description: string
  setBy: string
  defaultHint: string
}

const GROUPMATCH_META: SystemVariableMeta = {
  description: '正規表現マッチの部分文字列',
  setBy: 'waitregex',
  defaultHint: '空文字（未マッチ）',
}

export const SYSTEM_VARIABLE_META: Record<string, SystemVariableMeta> = {
  timeout: {
    description: 'wait 系コマンドのタイムアウト秒',
    setBy: 'timeout = 値 で変更',
    defaultHint: '0（初期値）',
  },
  mtimeout: {
    description: 'ミリ秒単位のタイムアウト',
    setBy: 'mtimeout = 値 で変更',
    defaultHint: '0（初期値）',
  },
  result: {
    description: 'コマンドの成否・戻り値',
    setBy: '直前に result を更新したコマンド（ホバーで詳細）',
    defaultHint: '0（初期値）',
  },
  inputstr: {
    description: 'ユーザーが入力した文字列',
    setBy: 'inputbox / passwordbox',
    defaultHint: '空文字（入力前）',
  },
  matchstr: {
    description: '受信データと一致した文字列',
    setBy: 'wait / waitln / waitregex',
    defaultHint: '空文字（未受信）',
  },
  paramcnt: getParamcntMeta(),
  params: getParamsArrayMeta(),
}

export function getSystemVariableMeta(name: string): SystemVariableMeta | undefined {
  const lower = name.toLowerCase()
  if (lower in SYSTEM_VARIABLE_META) return SYSTEM_VARIABLE_META[lower]
  if (/^groupmatchstr\d+$/.test(lower)) return GROUPMATCH_META
  const paramMatch = /^param(\d+)$/.exec(lower)
  if (paramMatch) {
    const n = Number(paramMatch[1])
    if (n >= 1 && n <= 9) return getParamNMeta(n)
  }
  return undefined
}
