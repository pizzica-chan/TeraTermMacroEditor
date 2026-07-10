/** Tera Term マクロ v5: コマンドが変数・result に書き込む仕様 */

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
    'findfirst',
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
    'getdate',
    'gettime',
    'getver',
    'getspecialfolder',
    'clipb2var',
    'loginfo',
  ),
  strcopy: {
    variables: [{ index: 4, type: 'string' }],
  },
  filecreate: {
    variables: [{ index: 1, type: 'integer' }],
    setsResult: true,
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
    setsResult: true,
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
    'strlen',
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
    'findclose',
  ),
  // setsResult を伴う出力（intOut1/strOut1 の上書き）
  str2int: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  str2code: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  getmodemstatus: { variables: [{ index: 1, type: 'integer' }], setsResult: true },
  getttdir: { variables: [{ index: 1, type: 'string' }], setsResult: true },
  getspecialfolder: { variables: [{ index: 1, type: 'string' }], setsResult: true },
  clipb2var: { variables: [{ index: 1, type: 'string' }], setsResult: true },
  loginfo: { variables: [{ index: 1, type: 'string' }], setsResult: true },
  sprintf: {
    setsResult: true,
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  recvln: {
    setsResult: true,
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  waitrecv: {
    setsResult: true,
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  inputbox: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  passwordbox: {
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  filenamebox: {
    setsResult: true,
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  dirnamebox: {
    setsResult: true,
    systemVariables: [{ name: 'inputstr', type: 'string' }],
  },
  yesnobox: { setsResult: true },
  messagebox: { setsResult: true },
  statusbox: { setsResult: true },
  strmatch: {
    setsResult: true,
    systemVariables: [{ name: 'matchstr', type: 'string' }, ...GROUPMATCH_SYSTEM_VARS],
  },
}

export function getCommandOutputEffect(cmd: string): CommandOutputEffect | undefined {
  return COMMAND_OUTPUT_EFFECTS[cmd.toLowerCase()]
}

export function getOutputVariableIndices(cmd: string): ReadonlySet<number> {
  const effect = getCommandOutputEffect(cmd)
  if (!effect?.variables) return new Set()
  return new Set(effect.variables.map((v) => v.index))
}

/** 第1引数が出力変数のコマンド（後方互換・補完等） */
export function isArg1OutputCommand(cmd: string): boolean {
  const effect = getCommandOutputEffect(cmd)
  return effect?.variables?.some((v) => v.index === 1) ?? false
}

export function getOutputVariableType(cmd: string, index = 1): OutputVarType | undefined {
  return getCommandOutputEffect(cmd)?.variables?.find((v) => v.index === index)?.type
}
