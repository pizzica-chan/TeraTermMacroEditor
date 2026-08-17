/**
 * 代入右辺へのコマンド名誤用（datestr = getdate 等）の検出。
 * 公式マニュアル v5 のコマンド行形式に基づく。
 * @see https://teratermproject.github.io/manual/5/en/macro/syntax/lineformats.html
 * @see https://teratermproject.github.io/manual/5/en/macro/command/
 */
import { getCommandArgSpec } from './commandArgs'
import {
  type CommandOutputEffect,
  getCommandOutputEffect,
} from './commandOutputs'
import type { Token } from './tokenize'

export interface AssignmentCommandMisuseDiagnostic {
  line: number
  column: number
  endColumn: number
  message: string
  severity: 'warning'
}

/**
 * result のみ更新するコマンドのうち、代入右辺誤用としては警告しないもの。
 * wait / connect 等は変数名としても使われやすく、誤用と変数参照の区別がつきにくい。
 * yesnobox / strlen / listbox 等は関数的に誤用されやすいので警告する。
 * waitrecv は inputstr も更新するため、この除外ではなく出力コマンドとして警告する。
 */
const RESULT_ONLY_ASSIGNMENT_EXCLUDE = new Set([
  'wait',
  'waitln',
  'waitregex',
  'wait4all',
  'waitn',
  'waitevent',
  'connect',
  'cygconnect',
  'testlink',
  'exec',
  'bplusrecv',
  'xmodemrecv',
  'kmtget',
])

const INPUT_DIALOG_COMMANDS = new Set([
  'inputbox',
  'passwordbox',
  'filenamebox',
  'dirnamebox',
])

const SYSTEM_VAR_OUTPUT_COMMANDS = new Set([
  'sprintf',
  'recvln',
  'waitrecv',
  'strmatch',
  'strsplit',
])

function hasOutputMisuseTarget(cmd: string): boolean {
  const key = cmd.toLowerCase()
  const effect = getCommandOutputEffect(key)
  if (!effect) return false
  if (effect.variables?.length || effect.systemVariables?.length) return true
  if (effect.setsResult && !RESULT_ONLY_ASSIGNMENT_EXCLUDE.has(key)) return true
  return false
}

function hasUserDeclaredVariable(
  name: string,
  varMap?: ReadonlyMap<string, { isSystem?: boolean }>,
): boolean {
  if (!varMap) return false
  const info = varMap.get(name.toLowerCase())
  return !!info && !info.isSystem
}

function pickPrimaryDestSlot(effect: CommandOutputEffect): { index: number; type: 'integer' | 'string' } | undefined {
  const vars = effect.variables
  if (!vars?.length) return undefined
  const stringSlots = vars.filter((v) => v.type === 'string')
  if (stringSlots.length > 0) return stringSlots[stringSlots.length - 1]
  return vars[0]
}

function buildExampleFromOutput(cmd: string, lhsVar: string, effect: CommandOutputEffect): string | undefined {
  const key = cmd.toLowerCase()
  const spec = getCommandArgSpec(key)
  const dest = pickPrimaryDestSlot(effect)

  if (INPUT_DIALOG_COMMANDS.has(key)) {
    return `${key} '…' '…' を実行し、必要なら \`${lhsVar} = inputstr\``
  }
  if (SYSTEM_VAR_OUTPUT_COMMANDS.has(key)) {
    const sys = effect.systemVariables?.[0]?.name ?? 'inputstr'
    if (key === 'strmatch') {
      return `${key} … を実行し、必要なら \`${lhsVar} = matchstr\` 等を参照`
    }
    if (key === 'strsplit') {
      return `${key} … を実行し、必要なら \`${lhsVar} = groupmatchstr1\` 等を参照`
    }
    return `${key} … を実行し、必要なら \`${lhsVar} = ${sys}\``
  }

  if (!dest && effect.setsResult) {
    return `\`${key} …\` を実行し、結果は result を参照してください`
  }
  if (!dest) return undefined

  switch (key) {
    case 'getenv':
      return `getenv '変数名' ${lhsVar}`
    case 'getdate':
    case 'gettime':
      return `${key} ${lhsVar}`
    case 'random':
      return `random ${lhsVar} 最大値`
    case 'getspecialfolder':
      return `getspecialfolder ${lhsVar} Desktop`
    case 'int2str':
    case 'code2str':
      return `${key} ${lhsVar} 整数`
    case 'str2int':
    case 'str2code':
      return `${key} ${lhsVar} '…'`
    case 'strcopy':
      return `strcopy '文字列' 1 1 ${lhsVar}`
    case 'expandenv':
      return `expandenv ${lhsVar}` + (spec && spec.max !== null && spec.max >= 2 ? ` または expandenv ${lhsVar} '…'` : '')
    case 'fileopen':
      return `fileopen ${lhsVar} 'file.dat' 0`
    case 'filecreate':
      return `filecreate ${lhsVar} 'file.dat'`
    case 'filereadln':
      return `filereadln fhandle ${lhsVar}`
    case 'fileread':
      return `fileread fhandle 長さ ${lhsVar}`
    case 'findnext':
      return `findnext handle ${lhsVar}`
    case 'findfirst':
      return `findfirst handle '*' ${lhsVar}`
    case 'getpassword':
      return `getpassword '…' '…' ${lhsVar}`
    case 'getpassword2':
      return `getpassword2 '…' '…' '…' ${lhsVar}`
    case 'getipv4addr':
    case 'getipv6addr':
      return `${key} ipaddr ${lhsVar}`
    case 'sprintf2':
      return `sprintf2 ${lhsVar} '%d' 値`
    case 'makepath':
      return `makepath ${lhsVar} 'dir' 'file'`
    case 'basename':
    case 'dirname':
      return `${key} ${lhsVar} パス`
    case 'getttpos':
      return `getttpos は9個の整数変数に書き込みます（例: getttpos x1 x2 … x9）`
    default:
      break
  }

  if (dest.index === 1) {
    if (spec && spec.min >= 2) return `${key} ${lhsVar} …`
    return `${key} ${lhsVar}`
  }
  if (dest.index === 2) return `${key} … ${lhsVar}`
  if (dest.index === 3) return `${key} … … ${lhsVar}`
  if (dest.index === 4) return `${key} … … … ${lhsVar}`
  return `${key} …（第${dest.index}引数に ${lhsVar}）`
}

/** 代入右辺が単一の識別子で、出力を持つ TTL コマンド名のとき誤用とみなす */
export function findAssignmentRhsCommandToken(
  tokens: readonly Token[],
  assignIdx: number,
  varMap?: ReadonlyMap<string, { isSystem?: boolean }>,
): Token | undefined {
  const rhsStart = assignIdx + 1
  if (rhsStart >= tokens.length) return undefined
  const rhsTok = tokens[rhsStart]
  if (rhsTok?.kind !== 'identifier') return undefined
  if (rhsStart + 1 < tokens.length) return undefined
  const cmd = rhsTok.text.toLowerCase()
  if (!hasOutputMisuseTarget(cmd)) return undefined
  if (hasUserDeclaredVariable(cmd, varMap)) return undefined
  return rhsTok
}

export function buildAssignmentRhsCommandMisuseMessage(cmd: string, lhsVar: string): string {
  const key = cmd.toLowerCase()
  const effect = getCommandOutputEffect(key)
  const example = effect ? buildExampleFromOutput(key, lhsVar, effect) : undefined
  if (example) {
    return `'${key}' はコマンドです。${example.includes('`') ? example : `\`${example}\` のように書きます`}（\`${lhsVar} = ${key}\` は変数 '${key}' の読み取りです）`
  }
  return `'${key}' はコマンド名です。TTL では代入右辺に書いてもコマンドは呼び出されず、変数 '${key}' の値を読み取ります`
}

export function checkAssignmentRhsCommandMisuse(
  tokens: readonly Token[],
  assignIdx: number,
  lineNum: number,
  lhsVar: string,
  varMap?: ReadonlyMap<string, { isSystem?: boolean }>,
): AssignmentCommandMisuseDiagnostic | undefined {
  const rhsTok = findAssignmentRhsCommandToken(tokens, assignIdx, varMap)
  if (!rhsTok) return undefined
  return {
    line: lineNum,
    column: rhsTok.column,
    endColumn: rhsTok.column + rhsTok.text.length,
    message: buildAssignmentRhsCommandMisuseMessage(rhsTok.text.toLowerCase(), lhsVar),
    severity: 'warning',
  }
}

/** テスト用: 出力コマンドを代入右辺誤用の警告対象とするか */
export function isAssignmentRhsCommandMisuseTarget(cmd: string): boolean {
  return hasOutputMisuseTarget(cmd.toLowerCase())
}
