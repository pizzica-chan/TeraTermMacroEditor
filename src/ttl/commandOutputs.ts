/** Tera Term マクロ v5: コマンドが変数・result に書き込む仕様 */

import { commandSetsResult } from './resultCommandMeta'

export type OutputVarType = 'integer' | 'string'

export interface OutputVariableSlot {
  /** tokenize 後のインデックス（先頭コマンド = 0） */
  index: number
  type: OutputVarType
}

export interface CommandOutputEffect {
  variables?: OutputVariableSlot[]
  setsResult?: boolean
  systemVariables?: { name: string; type: OutputVarType }[]
}

/** 未解決のコマンド出力プレースホルダ（表示用） */
export function commandOutputHint(cmd: string): string {
  return `（${cmd} の出力）`
}

/** matchstr / groupmatchstr の未解決プレースホルダ */
export const REGEX_MATCH_HINT = '（正規表現マッチ）'

/** ヒント文字列がコマンド出力／正規表現マッチのプレースホルダか */
export function isCommandOutputHint(hint: string): boolean {
  return hint.includes('の出力') || hint.includes('正規表現マッチ')
}

function intOut1(...cmds: string[]): Record<string, CommandOutputEffect> {
  const out: Record<string, CommandOutputEffect> = {}
  for (const cmd of cmds) {
    out[cmd] = { variables: [{ index: 1, type: 'integer' }] }
  }
  return out
}

function strOut1(...cmds: string[]): Record<string, CommandOutputEffect> {
  const out: Record<string, CommandOutputEffect> = {}
  for (const cmd of cmds) {
    out[cmd] = { variables: [{ index: 1, type: 'string' }] }
  }
  return out
}

function resultOnly(...cmds: string[]): Record<string, CommandOutputEffect> {
  const out: Record<string, CommandOutputEffect> = {}
  for (const cmd of cmds) {
    out[cmd] = { setsResult: true }
  }
  return out
}

const GROUPMATCH_SYSTEM_VARS = Array.from({ length: 9 }, (_, i) => ({
  name: `groupmatchstr${i + 1}`,
  type: 'string' as const,
}))

export const COMMAND_OUTPUT_EFFECTS: Record<string, CommandOutputEffect> = {
  ...intOut1(
    'str2int',
    'str2code',
    'random',
    'checksum8',
    'checksum16',
    'checksum32',
    'crc16',
    'crc32',
    'uptime',
    'rotateleft',
    'rotateright',
    'getmodemstatus',
  ),
  ...strOut1(
    'int2str',
    'code2str',
    'strconcat',
    'strinsert',
    'strremove',
    'strreplace',
    'strtrim',
    'tolower',
    'toupper',
    'strjoin',
    'sprintf2',
    'expandenv',
    'gethostname',
    'gettitle',
    'getttdir',
    'getdir',
    'basename',
    'dirname',
    'makepath',
    'getver',
    'getspecialfolder',
    'clipb2var',
    'loginfo',
  ),
  getdate: {
    variables: [{ index: 1, type: 'string' }],
    setsResult: true,
  },
  gettime: {
    variables: [{ index: 1, type: 'string' }],
    setsResult: true,
  },
  strcopy: {
    variables: [{ index: 4, type: 'string' }],
  },
  filecreate: {
    variables: [{ index: 1, type: 'integer' }],
    setsResult: true,
  },
  fileopen: {
    variables: [{ index: 1, type: 'integer' }],
  },
  getenv: {
    variables: [{ index: 2, type: 'string' }],
  },
  filereadln: {
    variables: [{ index: 2, type: 'string' }],
    setsResult: true,
  },
  fileread: {
    variables: [{ index: 3, type: 'string' }],
    setsResult: true,
  },
  findnext: {
    variables: [{ index: 2, type: 'string' }],
  },
  findfirst: {
    // findfirst <dir handle> <file name> <strvar>
    variables: [
      { index: 1, type: 'integer' },
      { index: 3, type: 'string' },
    ],
  },
  getpassword: {
    variables: [{ index: 3, type: 'string' }],
    setsResult: true,
  },
  getpassword2: {
    variables: [{ index: 4, type: 'string' }],
    setsResult: true,
  },
  getttpos: {
    variables: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => ({ index, type: 'integer' as const })),
    setsResult: true,
  },
  filestat: {
    variables: [
      { index: 2, type: 'integer' },
      { index: 3, type: 'string' },
      { index: 4, type: 'string' },
    ],
    setsResult: true,
  },
  getipv4addr: {
    variables: [{ index: 2, type: 'integer' }],
    setsResult: true,
  },
  getipv6addr: {
    variables: [{ index: 2, type: 'integer' }],
    setsResult: true,
  },
  checksum8file: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  checksum16file: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  checksum32file: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  crc16file: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  crc32file: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  ...resultOnly(
    // setsResult は getCommandOutputEffect が RESULT_COMMAND_META から付与する。
    // ここは他に出力スロットが無いコマンドのプレースホルダ登録用。
    'strlen',
    'strlength',
    'strcompare',
    'strscan',
    'filesearch',
    'foldersearch',
    'getfileattr',
    'ifdefined',
    'ispassword',
    'ispassword2',
    'kmtget',
    'listbox',
    'bplusrecv',
    'xmodemrecv',
    'connect',
    'cygconnect',
    'testlink',
    'exec',
    'wait',
    'waitln',
    'waitregex',
    'wait4all',
    'waitn',
    'waitevent',
    'yesnobox',
  ),
  // 出力変数 + result（setsResult は getCommandOutputEffect で付与）
  // intOut1/strOut1 と衝突するコマンドはここに再定義する（後勝ちスプレッドで variables が消えないように）
  str2int: { variables: [{ index: 1, type: 'integer' }] },
  str2code: { variables: [{ index: 1, type: 'integer' }] },
  getmodemstatus: { variables: [{ index: 1, type: 'integer' }] },
  getttdir: { variables: [{ index: 1, type: 'string' }] },
  getspecialfolder: { variables: [{ index: 1, type: 'string' }] },
  clipb2var: { variables: [{ index: 1, type: 'string' }] },
  loginfo: { variables: [{ index: 1, type: 'string' }] },
  sprintf: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  recvln: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  waitrecv: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  inputbox: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  passwordbox: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  filenamebox: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  dirnamebox: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  strmatch: {
    systemVariables: [{ name: 'matchstr', type: 'string' }, ...GROUPMATCH_SYSTEM_VARS],
  },
  strsplit: {
    systemVariables: GROUPMATCH_SYSTEM_VARS,
  },
}

export function getCommandOutputEffect(cmd: string): CommandOutputEffect | undefined {
  const key = cmd.toLowerCase()
  const base = COMMAND_OUTPUT_EFFECTS[key]
  const setsResult = commandSetsResult(key)
  if (!base && !setsResult) return undefined
  if (!base) return { setsResult: true }
  // setsResult は RESULT_COMMAND_META のみを正とする（base 内の古い setsResult は無視）
  const { setsResult: _ignored, ...rest } = base
  return setsResult ? { ...rest, setsResult: true } : { ...rest }
}

export function getOutputVariableIndices(cmd: string): ReadonlySet<number> {
  const effect = getCommandOutputEffect(cmd)
  if (!effect?.variables) return new Set()
  return new Set(effect.variables.map((v) => v.index))
}

/** dest を読んで書き戻す文字列コマンド。sprintf2 / strcopy 等の出力専用 dest は含まない */
const IN_PLACE_STRING_COMMANDS = new Set([
  'strconcat',
  'strinsert',
  'strremove',
  'strreplace',
  'strtrim',
  'strspecial',
])

export function isInPlaceStringCommand(cmd: string): boolean {
  return IN_PLACE_STRING_COMMANDS.has(cmd.toLowerCase())
}

/** 第1引数が出力変数のコマンド（後方互換・補完等） */
export function isArg1OutputCommand(cmd: string): boolean {
  const effect = getCommandOutputEffect(cmd)
  return effect?.variables?.some((v) => v.index === 1) ?? false
}

export function getOutputVariableType(cmd: string, index = 1): OutputVarType | undefined {
  return getCommandOutputEffect(cmd)?.variables?.find((v) => v.index === index)?.type
}

/**
 * 出力が TTL 引数から導出せず、実行時に新たに決まるコマンド。
 * これらが未確定変数の「原因」（仮定対象）。sprintf2 / strconcat 等の変換は含まない。
 */
export const INDEPENDENT_OUTPUT_COMMANDS = new Set([
  'random',
  'uptime',
  'getmodemstatus',
  'gethostname',
  'gettitle',
  'getttdir',
  'getdir',
  'getver',
  'getspecialfolder',
  'clipb2var',
  'loginfo',
  'expandenv',
  'getdate',
  'gettime',
  'getenv',
  'filecreate',
  'fileopen',
  'filereadln',
  'fileread',
  'findfirst',
  'findnext',
  'getpassword',
  'getpassword2',
  'getttpos',
  'filestat',
  'getipv4addr',
  'getipv6addr',
  'checksum8file',
  'checksum16file',
  'checksum32file',
  'crc16file',
  'crc32file',
  'inputbox',
  'passwordbox',
  'filenamebox',
  'dirnamebox',
  'recvln',
  'waitrecv',
])

export function commandIntroducesIndependentOutput(cmd: string): boolean {
  return INDEPENDENT_OUTPUT_COMMANDS.has(cmd.toLowerCase())
}
