import {
  TTL_COMMANDS,
  getSystemVariableType,
  isSystemVariable,
} from './commands'
import { checkCommandArgs, findAssignmentIndex } from './argChecker'
import { getCommandOutputEffect, getOutputVariableIndices } from './commandOutputs'
import {
  computeLoopIncludeEffectiveRaw,
  createForLoopBlockList,
  extractIncludeArgText,
  getForLoopBlockForLine,
  getLoopContextForLine,
  includeDynamicBindingKey,
  includeLoopIterationBindingKey,
  normalizeIncludePath,
  type IncludeResolveContext,
  type ForLoopBlock,
} from './includeRefs'
import {
  tryStaticIntegerCommand,
  tryStaticStringCommand,
  type StaticValueContext,
} from './staticCommandEval'
import {
  RESERVED,
  tokenizeLine,
  stripComments,
  getStringLiteralError,
  unquoteString,
  findNonAsciiOutsideLiterals,
  type Token,
} from './tokenize'
import {
  collectLabelNames,
  formatLabelRef,
  getGotoCallTargetToken,
  isGotoCallLabelRef,
  labelNameFromToken,
  normalizeLabelName,
} from './labels'
import {
  findSingleLineIfTailStart,
  hasThenKeyword,
  MAX_LABEL_COUNT,
  sourceContainsCall,
} from './subroutine'

export type VarType = 'integer' | 'string' | 'array' | 'unknown'

export interface VariableInfo {
  name: string
  type: VarType
  declaredAt: number
  usedAt: number[]
  isSystem: boolean
  isUsed: boolean
  /** strdim / intdim で宣言済み（システム配列 params も true） */
  arrayDeclared?: boolean
  /** 静的に判明している要素数 */
  arraySize?: number
  /** intdim → integer、strdim → string */
  arrayElementType?: 'integer' | 'string'
  /** 数値リテラル代入などで静的に判明した整数値 */
  constantValue?: number
  /** 文字列リテラル代入や strcopy などで静的に判明した文字列値 */
  constantString?: string
  /** include 先のソース内でのみ宣言された（親タブの未使用警告対象外） */
  declaredInInclude?: boolean
  /** include 元タブで宣言された変数（include 先タブ解析用に注入） */
  declaredExternally?: boolean
  /** include 元タブ側での使用（include 先で宣言した変数の未使用判定用） */
  usedOutsideInclude?: boolean
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  line: number
  column: number
  endColumn?: number
  message: string
  severity: DiagnosticSeverity
}

export interface AnalysisResult {
  variables: VariableInfo[]
  diagnostics: Diagnostic[]
}

export interface IncludeResolver {
  resolve(path: string): string | null
  /** 変数指定 include（引数テキストでリンク先タブを解決） */
  resolveDynamic(rawArg: string, context?: IncludeResolveContext): string | null
  getLinkedTabId(bindingKey: string, rawArg?: string, effectiveRaw?: string): string | null
  /** インクルード先タブ用の resolver（ネストした include 用） */
  resolverForLinkedTab(tabId: string): IncludeResolver | null
}

export interface AnalyzeOptions {
  includeResolver?: IncludeResolver
  /** 他タブ（include 元）での使用として扱う変数名 */
  externallyUsedNames?: ReadonlySet<string>
  /** include 元タブで宣言済みの変数（include 先タブ解析時に注入） */
  externallyDeclaredVars?: ReadonlyMap<string, VariableInfo>
  /** include 連携の変数収集（親タブ解析時に指定） */
  includeExchange?: IncludeCrossTabVarCollector
}

/** include 親子タブ間の変数連携 */
export interface IncludeCrossTabVarContext {
  /** 親タブで宣言され include 先から参照可能な変数 */
  externallyDeclared: Map<string, VariableInfo>
  /** include 先で宣言され親タブでのみ使用される変数名 */
  externallyUsed: Set<string>
}

export interface IncludeCrossTabVarCollector {
  targetTabId: string
  externallyDeclared: Map<string, VariableInfo>
  externallyUsed: Set<string>
}

export function collectIncludeCrossTabVarContext(
  parentSource: string,
  parentResolver: IncludeResolver,
  childTabId: string,
): IncludeCrossTabVarContext {
  const externallyDeclared = new Map<string, VariableInfo>()
  const externallyUsed = new Set<string>()
  analyzeTTL(parentSource, {
    includeResolver: parentResolver,
    includeExchange: { targetTabId: childTabId, externallyDeclared, externallyUsed },
  })
  return { externallyDeclared, externallyUsed }
}

interface AnalysisContext {
  diagnostics: Diagnostic[]
  varMap: Map<string, VariableInfo>
  labels: Set<string>
  /** ファイル内の全ラベル（前方参照の解決用） */
  knownLabels: Set<string>
  blockStack: { keyword: string; line: number }[]
  includeResolver?: IncludeResolver
  includeStack: string[]
  /** インクルード先タブ ID のスタック（同一タブへの別キー経由の循環検出） */
  includeTabStack: string[]
  /** インクルード先の行に対する診断を抑制（親タブのリントと行番号がずれるため） */
  suppressDiagnostics: boolean
  forLoopBlocks: ForLoopBlock[]
  /** トップレベルの end / exit 以降（ファイル全体がデッドコード） */
  fileUnreachable: boolean
  /** ブロック内の end / exit 以降（endif 等でスコープ復帰） */
  blockUnreachableStack: boolean[]
  /** goto / return 以降のフォールスルー到達不能（ラベル行でリセット） */
  fallthroughDeadStack: boolean[]
  topLevelFallthroughDead: boolean
  hasCallInFile: boolean
  includeExchange?: IncludeCrossTabVarCollector
}

function cloneVariableInfo(info: VariableInfo): VariableInfo {
  return { ...info, usedAt: [...info.usedAt] }
}

function snapshotParentScopeVars(varMap: Map<string, VariableInfo>): Map<string, VariableInfo> {
  const snap = new Map<string, VariableInfo>()
  for (const [key, info] of varMap) {
    if (info.declaredInInclude || info.declaredExternally) continue
    snap.set(key, cloneVariableInfo(info))
  }
  return snap
}

function mergeExternalVarMaps(
  target: Map<string, VariableInfo>,
  source: ReadonlyMap<string, VariableInfo>,
): void {
  for (const [key, info] of source) {
    if (!target.has(key)) {
      target.set(key, cloneVariableInfo(info))
    }
  }
}

function recordVariableUsage(ctx: AnalysisContext, info: VariableInfo, lineNum: number): void {
  info.usedAt.push(lineNum)
  info.isUsed = true
  if (!ctx.suppressDiagnostics) {
    info.usedOutsideInclude = true
  }
}

/** include 先は独立したソース単位で解析する（親のブロック・到達不能状態は引き継がない） */
function createIncludeChildContext(
  parent: AnalysisContext,
  content: string,
  childResolver: IncludeResolver,
): AnalysisContext {
  return {
    diagnostics: parent.diagnostics,
    varMap: parent.varMap,
    labels: new Set(),
    knownLabels: collectLabelNames(content),
    blockStack: [],
    includeResolver: childResolver,
    includeStack: parent.includeStack,
    includeTabStack: parent.includeTabStack,
    suppressDiagnostics: true,
    forLoopBlocks: createForLoopBlockList(content),
    fileUnreachable: false,
    blockUnreachableStack: [],
    fallthroughDeadStack: [],
    topLevelFallthroughDead: false,
    hasCallInFile: parent.hasCallInFile,
  }
}

interface LineLoopResult {
  exit: boolean
  terminator?: 'end' | 'exit'
}

interface LineLoopOpts {
  stopOnExit?: boolean
}

function isLineUnreachable(ctx: AnalysisContext): boolean {
  const blockUnreachable =
    ctx.blockUnreachableStack[ctx.blockUnreachableStack.length - 1] ?? false
  const fallthroughDead =
    ctx.topLevelFallthroughDead ||
    (ctx.fallthroughDeadStack[ctx.fallthroughDeadStack.length - 1] ?? false)
  return ctx.fileUnreachable || blockUnreachable || fallthroughDead
}

function enterBlockScope(ctx: AnalysisContext): void {
  ctx.blockUnreachableStack.push(false)
  ctx.fallthroughDeadStack.push(false)
}

function leaveBlockScope(ctx: AnalysisContext): void {
  ctx.blockUnreachableStack.pop()
  ctx.fallthroughDeadStack.pop()
}

function markFallthroughDead(ctx: AnalysisContext): void {
  const depth = ctx.fallthroughDeadStack.length
  if (depth > 0) {
    ctx.fallthroughDeadStack[depth - 1] = true
  } else {
    ctx.topLevelFallthroughDead = true
  }
}

function clearFallthroughDead(ctx: AnalysisContext): void {
  ctx.topLevelFallthroughDead = false
  const depth = ctx.fallthroughDeadStack.length
  if (depth > 0) {
    ctx.fallthroughDeadStack[depth - 1] = false
  }
}

function markMacroTerminator(ctx: AnalysisContext, atTopLevel: boolean): void {
  if (atTopLevel) {
    ctx.fileUnreachable = true
    return
  }
  const depth = ctx.blockUnreachableStack.length
  if (depth > 0) {
    ctx.blockUnreachableStack[depth - 1] = true
  } else {
    ctx.fileUnreachable = true
  }
}

/** if ブロックの別分岐（elseif / else）に入るとき、直前分岐の end / exit / goto / return 状態をリセット */
function startNewIfBranch(ctx: AnalysisContext): void {
  const depth = ctx.blockUnreachableStack.length
  if (depth > 0) {
    ctx.blockUnreachableStack[depth - 1] = false
    ctx.fallthroughDeadStack[depth - 1] = false
  }
}

function warnDeadCode(ctx: AnalysisContext, lineNum: number): void {
  if (ctx.suppressDiagnostics) return
  const blockUnreachable =
    ctx.blockUnreachableStack[ctx.blockUnreachableStack.length - 1] ?? false
  const fallthroughDead =
    ctx.topLevelFallthroughDead ||
    (ctx.fallthroughDeadStack[ctx.fallthroughDeadStack.length - 1] ?? false)

  let message: string
  if (ctx.fileUnreachable) {
    message = 'この行には到達しません（end / exit によりマクロの実行が終了した後のコードです）'
  } else if (blockUnreachable) {
    message = 'この行には到達しません（ブロック内の end / exit より後のコードです）'
  } else if (fallthroughDead) {
    message = 'この行には到達しません（goto / return によりフォールスルーしません）'
  } else {
    return
  }

  pushDiagnostic(ctx, {
    line: lineNum,
    column: 0,
    message,
    severity: 'warning',
  })
}

function inferTypeFromValue(text: string): VarType {
  if (text.startsWith("'") || text.startsWith('"')) return 'string'
  if (/^-?\d+(\.\d+)?$/.test(text)) return 'integer'
  return 'unknown'
}

const MIN_ARRAY_SIZE = 1
const MAX_ARRAY_SIZE = 65536

function isArrayAssignTarget(tokens: ReturnType<typeof tokenizeLine>, eqIdx: number): string | null {
  if (eqIdx < 3) return null
  const close = tokens[eqIdx - 1]
  const index = tokens[eqIdx - 2]
  const open = tokens[eqIdx - 3]
  const name = tokens[eqIdx - 4]
  if (
    close?.text === ']' &&
    open?.text === '[' &&
    name?.kind === 'identifier' &&
    (index?.kind === 'number' || index?.kind === 'identifier')
  ) {
    return name.text
  }
  return null
}

function resolveStaticInteger(
  token: Token | undefined,
  varMap: Map<string, VariableInfo>,
): number | undefined {
  if (!token) return undefined
  if (token.kind === 'number') {
    const n = Number(token.text)
    return Number.isFinite(n) ? Math.trunc(n) : undefined
  }
  if (token.kind === 'identifier') {
    return varMap.get(token.text.toLowerCase())?.constantValue
  }
  return undefined
}

function applyConstantValue(
  info: VariableInfo,
  valueToken: Token | undefined,
  varMap: Map<string, VariableInfo>,
): void {
  if (!valueToken) {
    info.constantValue = undefined
    info.constantString = undefined
    return
  }
  info.constantValue = resolveStaticInteger(valueToken, varMap)
  applyConstantString(info, valueToken, varMap)
}

function resolveStaticString(
  token: Token | undefined,
  varMap: Map<string, VariableInfo>,
): string | undefined {
  if (!token) return undefined
  if (token.kind === 'string') return unquoteString(token.text)
  if (token.kind === 'identifier') {
    return varMap.get(token.text.toLowerCase())?.constantString
  }
  return undefined
}

function applyConstantString(
  info: VariableInfo,
  valueToken: Token | undefined,
  varMap: Map<string, VariableInfo>,
): void {
  if (!valueToken) {
    info.constantString = undefined
    return
  }
  if (valueToken.kind === 'string') {
    info.constantString = unquoteString(valueToken.text)
    return
  }
  if (valueToken.kind === 'identifier') {
    info.constantString = varMap.get(valueToken.text.toLowerCase())?.constantString
    return
  }
  info.constantString = undefined
}

function createAnalyzerStaticCtx(
  tokens: Token[],
  offset: number,
  varMap: Map<string, VariableInfo>,
): StaticValueContext {
  return {
    tokenAt(rel) {
      return tokens[offset + rel]
    },
    resolveString(rel) {
      return resolveStaticString(tokens[offset + rel], varMap)
    },
    resolveInt(rel) {
      return resolveStaticInteger(tokens[offset + rel], varMap)
    },
    resolveInPlaceVar(rel) {
      const tok = tokens[offset + rel]
      if (tok?.kind !== 'identifier') return undefined
      return varMap.get(tok.text.toLowerCase())?.constantString
    },
  }
}

function applyStaticCommandConstants(
  ctx: AnalysisContext,
  tokens: Token[],
  offset: number,
  cmd: string,
): void {
  const staticCtx = createAnalyzerStaticCtx(tokens, offset, ctx.varMap)
  const strResult = tryStaticStringCommand(cmd, offset, staticCtx)
  if (strResult) {
    const destTok = tokens[strResult.destIndex]
    if (destTok?.kind === 'identifier') {
      const varKey = destTok.text.toLowerCase()
      const existing = ctx.varMap.get(varKey)
      if (existing) {
        existing.constantString = strResult.value
        if (existing.type === 'unknown') existing.type = 'string'
      }
    }
    return
  }

  const intResult = tryStaticIntegerCommand(cmd, offset, staticCtx)
  if (!intResult) return
  const destTok = tokens[intResult.destIndex]
  if (destTok?.kind !== 'identifier') return
  const varKey = destTok.text.toLowerCase()
  const existing = ctx.varMap.get(varKey)
  if (existing) {
    existing.constantValue = intResult.value
    if (existing.type === 'unknown') existing.type = 'integer'
  }
}

function isSystemArray(name: string): boolean {
  return getSystemVariableType(name) === 'array'
}

function checkArrayAccess(
  ctx: AnalysisContext,
  lineNum: number,
  arrayName: string,
  indexToken: Token | undefined,
  arrayInfo: VariableInfo | undefined,
  nameColumn: number,
  nameLength: number,
): void {
  if (!arrayInfo) {
    if (!isSystemVariable(arrayName)) {
      pushDiagnostic(ctx, {
        line: lineNum,
        column: nameColumn,
        endColumn: nameColumn + nameLength,
        message: `配列 '${arrayName}' は strdim または intdim で宣言する必要があります`,
        severity: 'error',
      })
    } else if (!isSystemArray(arrayName)) {
      pushDiagnostic(ctx, {
        line: lineNum,
        column: nameColumn,
        endColumn: nameColumn + nameLength,
        message: `変数 '${arrayName}' は配列ではありません`,
        severity: 'error',
      })
    }
    return
  }

  if (arrayInfo.type !== 'array' && arrayInfo.type !== 'unknown') {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: nameColumn,
      endColumn: nameColumn + nameLength,
      message: `変数 '${arrayName}' は配列ではありません（型: ${arrayInfo.type}）`,
      severity: 'error',
    })
    return
  }

  if (!arrayInfo.arrayDeclared && !arrayInfo.isSystem) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: nameColumn,
      endColumn: nameColumn + nameLength,
      message: `配列 '${arrayName}' は strdim または intdim で宣言する必要があります`,
      severity: 'error',
    })
    return
  }

  const index = resolveStaticInteger(indexToken, ctx.varMap)
  if (index === undefined) return

  if (index < 0) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: indexToken!.column,
      endColumn: indexToken!.column + indexToken!.text.length,
      message: `配列 '${arrayName}' の添字 ${index} は 0 未満です（添字は 0 始まり）`,
      severity: 'error',
    })
    return
  }

  if (arrayInfo.arraySize !== undefined && index >= arrayInfo.arraySize) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: indexToken!.column,
      endColumn: indexToken!.column + indexToken!.text.length,
      message: `配列 '${arrayName}' の添字 ${index} が宣言サイズ ${arrayInfo.arraySize} の範囲外です（有効: 0〜${arrayInfo.arraySize - 1}）`,
      severity: 'warning',
    })
  }
}

const BLOCK_PAIRS: [string, string][] = [
  ['if', 'endif'],
  ['while', 'endwhile'],
  ['for', 'next'],
  ['do', 'loop'],
  ['until', 'enduntil'],
]

function stmtOffset(tokens: Token[]): number {
  return tokens[0]?.kind === 'label' ? 1 : 0
}

function checkGotoCallLabelRef(
  ctx: AnalysisContext,
  target: Token | undefined,
  lineNum: number,
): void {
  const name = labelNameFromToken(target)
  if (!name) return
  const labelRef = normalizeLabelName(name)
  if (!ctx.knownLabels.has(labelRef)) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: target!.column,
      message: `ラベル '${formatLabelRef(name)}' が定義されていません`,
      severity: 'warning',
    })
  }
}

function closeBlock(ctx: AnalysisContext, open: string, lineNum: number, column: number, closeName: string): void {
  let matchIdx = -1
  for (let i = ctx.blockStack.length - 1; i >= 0; i--) {
    if (ctx.blockStack[i]!.keyword === open) {
      matchIdx = i
      break
    }
  }
  if (matchIdx < 0) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column,
      message: `'${closeName}' に対応する開始ブロックがありません`,
      severity: 'error',
    })
    return
  }
  while (ctx.blockStack.length > matchIdx) {
    leaveBlockScope(ctx)
    ctx.blockStack.pop()
  }
}

/** ブロック構造キーワード（デッドコード警告の対象外） */
const BLOCK_BRANCH_KEYWORDS = new Set([
  ...BLOCK_PAIRS.map(([, close]) => close),
  'elseif',
  'else',
])

function shouldWarnDeadCode(tokens: Token[]): boolean {
  let offset = 0
  if (tokens[0]?.kind === 'label') offset = 1
  const first = tokens[offset]
  if (first?.kind === 'identifier' && BLOCK_BRANCH_KEYWORDS.has(first.text.toLowerCase())) {
    return false
  }
  return true
}

function registerCommandOutputVariables(
  ctx: AnalysisContext,
  cmd: string,
  tokens: Token[],
  lineNum: number,
): void {
  const effect = getCommandOutputEffect(cmd)
  if (!effect?.variables) return

  for (const slot of effect.variables) {
    const tok = tokens[slot.index]
    if (tok?.kind !== 'identifier') continue

    const varName = tok.text
    const varKey = varName.toLowerCase()
    const outputType: VarType = slot.type === 'integer' ? 'integer' : 'string'
    const existing = ctx.varMap.get(varKey)

    if (!existing) {
      ctx.varMap.set(varKey, applyIncludeDeclarationScope({
        name: varName,
        type: outputType,
        declaredAt: lineNum,
        usedAt: [],
        isSystem: isSystemVariable(varName),
        isUsed: false,
      }, ctx))
    } else if (
      !existing.isSystem &&
      existing.type !== 'unknown' &&
      existing.type !== outputType
    ) {
      pushDiagnostic(ctx, {
        line: lineNum,
        column: tok.column,
        endColumn: tok.column + tok.text.length,
        message: `変数 '${varName}' の型が ${existing.type} ですが、'${cmd}' は ${outputType} 型の値を出力します`,
        severity: 'error',
      })
    } else if (existing.type === 'unknown') {
      existing.type = outputType
      if (existing.declaredAt === 0) {
        existing.declaredAt = lineNum
        if (ctx.suppressDiagnostics) existing.declaredInInclude = true
      }
    }
  }
}

function applyIncludeDeclarationScope(info: VariableInfo, ctx: AnalysisContext): VariableInfo {
  if (ctx.suppressDiagnostics) {
    info.declaredInInclude = true
  }
  return info
}

function markVariableUsed(ctx: AnalysisContext, lineNum: number, name: string): void {
  const lower = name.toLowerCase()
  if (RESERVED.has(lower)) return
  const info = ctx.varMap.get(lower)
  if (info) {
    recordVariableUsage(ctx, info, lineNum)
  }
}

/** include の引数に現れる変数を使用済みとして記録 */
function markIncludeArgumentUsage(ctx: AnalysisContext, tokens: Token[], lineNum: number, cmdIdx: number): void {
  const arg = tokens[cmdIdx + 1]
  if (!arg) return

  if (arg.kind === 'identifier' && tokens[cmdIdx + 2]?.text === '[') {
    markVariableUsed(ctx, lineNum, arg.text)
    const indexTok = tokens[cmdIdx + 3]
    if (indexTok?.kind === 'identifier') {
      markVariableUsed(ctx, lineNum, indexTok.text)
    }
    return
  }

  if (arg.kind === 'identifier') {
    markVariableUsed(ctx, lineNum, arg.text)
  }
}

function analyzeResolvedInclude(
  ctx: AnalysisContext,
  lineNum: number,
  first: Token,
  bindingKey: string,
  content: string | null,
  notLinkedMessage: string,
  rawArg?: string,
  effectiveRaw?: string,
): boolean {
  if (ctx.includeStack.includes(bindingKey)) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: first.column,
      message: `循環 include が検出されました: L${lineNum}`,
      severity: 'error',
    })
    return false
  }
  const linkedTabId = content ? ctx.includeResolver!.getLinkedTabId(bindingKey, rawArg, effectiveRaw) : null
  if (linkedTabId && ctx.includeTabStack.includes(linkedTabId)) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: first.column,
      message: `循環 include が検出されました（同一タブの再参照）: L${lineNum}`,
      severity: 'error',
    })
    return false
  }
  if (!content) {
    if (!ctx.suppressDiagnostics) {
      pushDiagnostic(ctx, {
        line: lineNum,
        column: first.column,
        message: notLinkedMessage,
        severity: 'info',
      })
    }
    return false
  }

  ctx.includeStack.push(bindingKey)
  if (linkedTabId) ctx.includeTabStack.push(linkedTabId)
  const childResolver = linkedTabId
    ? ctx.includeResolver!.resolverForLinkedTab(linkedTabId) ?? ctx.includeResolver!
    : ctx.includeResolver!
  const exchange = ctx.includeExchange
  if (linkedTabId && exchange?.targetTabId === linkedTabId) {
    mergeExternalVarMaps(exchange.externallyDeclared, snapshotParentScopeVars(ctx.varMap))
  }
  const childCtx = createIncludeChildContext(ctx, content, childResolver)
  const childResult = analyzeLines(stripComments(content), childCtx, { stopOnExit: true })
  ctx.includeStack.pop()
  if (linkedTabId) ctx.includeTabStack.pop()
  return childResult.terminator === 'end'
}

function pushDiagnostic(ctx: AnalysisContext, diag: Diagnostic): void {
  if (!ctx.suppressDiagnostics) ctx.diagnostics.push(diag)
}

function analyzeLines(lines: string[], ctx: AnalysisContext, loopOpts: LineLoopOpts): LineLoopResult {
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1
    const line = lines[lineIdx]!
    const tokens = tokenizeLine(line, lineNum)

    if (isLineUnreachable(ctx) && line.trim().length > 0 && shouldWarnDeadCode(tokens)) {
      warnDeadCode(ctx, lineNum)
    }

    if (tokens.length === 0) continue

    for (const tok of tokens) {
      if (tok.kind !== 'string') continue
      const err = getStringLiteralError(tok.text)
      if (err) {
        pushDiagnostic(ctx, {
          line: lineNum,
          column: tok.column,
          endColumn: tok.column + tok.text.length,
          message: err,
          severity: 'error',
        })
      }
    }

    if (tokens[0]?.kind === 'label') {
      const labelName = tokens[0].text.toLowerCase()
      clearFallthroughDead(ctx)
      if (ctx.labels.has(labelName)) {
        pushDiagnostic(ctx, {
          line: lineNum,
          column: tokens[0].column,
          message: `ラベル '${tokens[0].text}' が重複しています`,
          severity: 'warning',
        })
      }
      ctx.labels.add(labelName)
      tokens.shift()
    }

    if (tokens.length === 0) continue

    const first = tokens[0]!
    if (first.kind !== 'identifier') continue

    const cmd = first.text.toLowerCase()

    if (cmd === 'include') {
      markIncludeArgumentUsage(ctx, tokens, lineNum, 0)
      const arg = tokens[1]
      if (ctx.includeResolver && arg) {
        if (arg.kind === 'string') {
          const path = unquoteString(arg.text)
          const bindingKey = normalizeIncludePath(path)
          const content = ctx.includeResolver.resolve(path)
          const notLinkedMessage = `include '${path}' がタブにリンクされていないため、内容は解析に含まれません`
          if (analyzeResolvedInclude(ctx, lineNum, first, bindingKey, content, notLinkedMessage)) {
            ctx.fileUnreachable = true
          }
        } else {
          const rawArg = extractIncludeArgText(tokens, 0)
          const argLabel = rawArg || '（引数）'
          const notLinkedMessage = `include ${argLabel} がタブにリンクされていないため、内容は解析に含まれません`
          const loopCtx = getLoopContextForLine(ctx.forLoopBlocks, lineNum)
          if (loopCtx) {
            const loopBlock = getForLoopBlockForLine(ctx.forLoopBlocks, lineNum)
            for (const v of loopCtx.values) {
              const effectiveRaw = loopBlock
                ? computeLoopIncludeEffectiveRaw(lines, lineNum, loopBlock, rawArg, v)
                : undefined
              const bindingKey = includeLoopIterationBindingKey(lineNum, v)
              const resolveCtx: IncludeResolveContext = {
                line: lineNum,
                loopValue: v,
                rawArg,
                effectiveRaw,
              }
              const content = ctx.includeResolver.resolveDynamic(rawArg, resolveCtx)
              if (analyzeResolvedInclude(
                ctx,
                lineNum,
                first,
                bindingKey,
                content,
                notLinkedMessage,
                rawArg,
                effectiveRaw,
              )) {
                ctx.fileUnreachable = true
              }
            }
          } else {
            const bindingKey = includeDynamicBindingKey(rawArg)
            const content = ctx.includeResolver.resolveDynamic(rawArg)
            if (analyzeResolvedInclude(ctx, lineNum, first, bindingKey, content, notLinkedMessage, rawArg)) {
              ctx.fileUnreachable = true
            }
          }
        }
      }
      continue
    }

    if (cmd === 'end') {
      ctx.fileUnreachable = true
      if (loopOpts.stopOnExit) return { exit: true, terminator: 'end' }
    } else if (cmd === 'exit') {
      const exitsOnlyIncludeBlock = ctx.suppressDiagnostics && ctx.blockStack.length > 0
      markMacroTerminator(ctx, !exitsOnlyIncludeBlock)
      if (loopOpts.stopOnExit && !exitsOnlyIncludeBlock) {
        return { exit: true, terminator: 'exit' }
      }
    }

    if (
      (cmd === 'elseif' || cmd === 'else') &&
      ctx.blockStack[ctx.blockStack.length - 1]?.keyword === 'if'
    ) {
      startNewIfBranch(ctx)
    }

    for (const [open, close] of BLOCK_PAIRS) {
      if (cmd === open) {
        if (open === 'if' && !hasThenKeyword(tokens, stmtOffset(tokens))) {
          continue
        }
        enterBlockScope(ctx)
        ctx.blockStack.push({ keyword: open, line: lineNum })
      }
      if (cmd === close) {
        closeBlock(ctx, open, lineNum, first.column, first.text)
      }
    }

    const lineOffset = stmtOffset(tokens)
    const singleLineIfTail = cmd === 'if' ? findSingleLineIfTailStart(tokens, lineOffset) : null
    if (singleLineIfTail !== null) {
      const tailCmdTok = tokens[singleLineIfTail]
      const tailCmd = tailCmdTok?.kind === 'identifier' ? tailCmdTok.text.toLowerCase() : ''
      if (tailCmd === 'goto' || tailCmd === 'call') {
        checkGotoCallLabelRef(ctx, getGotoCallTargetToken(tokens, singleLineIfTail), lineNum)
      }
    }

    if (cmd === 'goto' || cmd === 'call') {
      checkGotoCallLabelRef(ctx, getGotoCallTargetToken(tokens, lineOffset), lineNum)
    }

    if (cmd === 'return' && !ctx.hasCallInFile) {
      pushDiagnostic(ctx, {
        line: lineNum,
        column: first.column,
        message: "return は call から呼び出されたサブルーチン内でのみ有効です（このファイルに call がありません）",
        severity: 'warning',
      })
    }

    if (cmd === 'goto' || cmd === 'return') {
      markFallthroughDead(ctx)
    }

    const assignIdx = findAssignmentIndex(tokens, tokens[0]?.kind === 'label' ? 1 : 0)

    let assignVarName: string | null = null
    if (assignIdx > 0) {
      if (tokens[assignIdx - 1]?.kind === 'identifier' && !RESERVED.has(tokens[assignIdx - 1]!.text.toLowerCase())) {
        assignVarName = tokens[assignIdx - 1]!.text
      } else {
        assignVarName = isArrayAssignTarget(tokens, assignIdx)
      }
    }

    if (!assignVarName && TTL_COMMANDS.has(cmd)) {
      for (const d of checkCommandArgs(cmd, tokens, lineNum, first.column)) {
        pushDiagnostic(ctx, d)
      }
    }

    if (assignVarName) {
      const varKey = assignVarName.toLowerCase()
      const valueToken = tokens[assignIdx + 1]
      const newType = valueToken ? inferTypeFromValue(valueToken.text) : 'unknown'
      const isArrayAssign = isArrayAssignTarget(tokens, assignIdx) !== null

      if (isArrayAssign) {
        const indexToken = tokens[assignIdx - 2]
        const existing = ctx.varMap.get(varKey)
        const nameTok = tokens.find((t) => t.kind === 'identifier' && t.text.toLowerCase() === varKey)
        checkArrayAccess(
          ctx,
          lineNum,
          assignVarName,
          indexToken,
          existing,
          nameTok?.column ?? 0,
          nameTok?.text.length ?? assignVarName.length,
        )
        if (existing?.arrayElementType && valueToken) {
          const valType = inferTypeFromValue(valueToken.text)
          if (valType !== 'unknown' && valType !== existing.arrayElementType) {
            pushDiagnostic(ctx, {
              line: lineNum,
              column: valueToken.column,
              endColumn: valueToken.column + valueToken.text.length,
              message: `配列 '${assignVarName}' の要素型は ${existing.arrayElementType} ですが、${valType} 型の値を代入しています`,
              severity: 'warning',
            })
          }
        }
      } else {
        const existing = ctx.varMap.get(varKey)
        const effectiveType: VarType = newType

        if (existing && !existing.isSystem && existing.type !== 'unknown' && effectiveType !== 'unknown' && existing.type !== effectiveType) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: tokens.find((t) => t.kind === 'identifier' && t.text.toLowerCase() === varKey)!.column,
            message: `変数 '${assignVarName}' の型が ${existing.type} から ${effectiveType} に変更されています（TTLでは型変更不可）`,
            severity: 'error',
          })
        } else if (!existing) {
          const info = applyIncludeDeclarationScope({
            name: assignVarName,
            type: effectiveType,
            declaredAt: lineNum,
            usedAt: [],
            isSystem: isSystemVariable(assignVarName),
            isUsed: false,
          }, ctx)
          applyConstantValue(info, valueToken, ctx.varMap)
          ctx.varMap.set(varKey, info)
        } else {
          if (existing.type === 'unknown' && effectiveType !== 'unknown') {
            existing.type = effectiveType
          }
          applyConstantValue(existing, valueToken, ctx.varMap)
        }
      }
    }

    if (cmd === 'for' && tokens[1]?.kind === 'identifier') {
      const varName = tokens[1].text
      const varKey = varName.toLowerCase()
      const existing = ctx.varMap.get(varKey)
      if (existing && !existing.isSystem && existing.type !== 'unknown' && existing.type !== 'integer') {
        pushDiagnostic(ctx, {
          line: lineNum,
          column: tokens[1].column,
          message: `for ループ変数 '${varName}' は整数型である必要があります（現在: ${existing.type}）`,
          severity: 'error',
        })
      } else if (!existing) {
        const info = applyIncludeDeclarationScope({
          name: varName,
          type: 'integer',
          declaredAt: lineNum,
          usedAt: [],
          isSystem: false,
          isUsed: false,
        }, ctx)
        recordVariableUsage(ctx, info, lineNum)
        ctx.varMap.set(varKey, info)
      } else {
        existing.type = existing.type === 'unknown' ? 'integer' : existing.type
        existing.constantValue = undefined
        recordVariableUsage(ctx, existing, lineNum)
      }
    }

    if ((cmd === 'strdim' || cmd === 'intdim') && tokens[1]?.kind === 'identifier') {
      const varName = tokens[1].text
      const varKey = varName.toLowerCase()
      const sizeToken = tokens[2]
      const staticSize = resolveStaticInteger(sizeToken, ctx.varMap)
      const elementType = cmd === 'intdim' ? 'integer' : 'string'

      if (staticSize !== undefined && (staticSize < MIN_ARRAY_SIZE || staticSize > MAX_ARRAY_SIZE)) {
        pushDiagnostic(ctx, {
          line: lineNum,
          column: sizeToken!.column,
          endColumn: sizeToken!.column + sizeToken!.text.length,
          message: `配列サイズは ${MIN_ARRAY_SIZE}〜${MAX_ARRAY_SIZE} の範囲である必要があります`,
          severity: 'error',
        })
      }

      const existing = ctx.varMap.get(varKey)
      if (!existing) {
        ctx.varMap.set(varKey, applyIncludeDeclarationScope({
          name: varName,
          type: 'array',
          declaredAt: lineNum,
          usedAt: [],
          isSystem: false,
          isUsed: false,
          arrayDeclared: true,
          arraySize: staticSize,
          arrayElementType: elementType,
        }, ctx))
      } else {
        if (
          existing.type !== 'unknown' &&
          existing.type !== 'array' &&
          !existing.isSystem
        ) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: tokens[1].column,
            endColumn: tokens[1].column + tokens[1].text.length,
            message: `変数 '${varName}' は既に ${existing.type} 型として使用されています`,
            severity: 'error',
          })
        }
        existing.type = 'array'
        existing.arrayDeclared = true
        existing.arrayElementType = elementType
        if (staticSize !== undefined) existing.arraySize = staticSize
        if (existing.declaredAt === 0) existing.declaredAt = lineNum
      }
    }

    registerCommandOutputVariables(ctx, cmd, tokens, lineNum)
    applyStaticCommandConstants(ctx, tokens, lineOffset, cmd)

    const assignVarKey = assignVarName?.toLowerCase() ?? null
    const arrayAssignName = assignIdx > 0 ? isArrayAssignTarget(tokens, assignIdx) : null
    const outputVarIndices = getOutputVariableIndices(cmd)

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!
      if (tok.kind !== 'identifier') continue

      const lower = tok.text.toLowerCase()
      if (RESERVED.has(lower)) continue
      if (outputVarIndices.has(i)) continue
      if (cmd === 'for' && i === 1) continue
      if ((cmd === 'strdim' || cmd === 'intdim') && i === 1) continue
      if ((cmd === 'goto' || cmd === 'call') && i === 1) continue
      if (isGotoCallLabelRef(tokens, i)) continue

      if (i > 0 && tokens[i - 1]?.text === '[' && tokens[i + 1]?.text === ']') {
        const info = ctx.varMap.get(lower)
        if (info) {
          recordVariableUsage(ctx, info, lineNum)
        } else if (!isSystemVariable(lower)) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: tok.column,
            endColumn: tok.column + tok.text.length,
            message: `未定義の変数 '${tok.text}' が使用されています`,
            severity: 'warning',
          })
        }
        continue
      }

      if (tokens[i + 1]?.text === '[') {
        const indexToken = tokens[i + 2]
        const info = ctx.varMap.get(lower)
        if (info) {
          recordVariableUsage(ctx, info, lineNum)
        } else if (!isSystemVariable(lower)) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: tok.column,
            endColumn: tok.column + tok.text.length,
            message: `未定義の変数 '${tok.text}' が使用されています`,
            severity: 'warning',
          })
        }
        checkArrayAccess(ctx, lineNum, tok.text, indexToken, info, tok.column, tok.text.length)
        continue
      }

      if (assignVarKey && lower === assignVarKey && !arrayAssignName) continue

      const info = ctx.varMap.get(lower)
      if (info) {
        recordVariableUsage(ctx, info, lineNum)
      } else if (!isSystemVariable(lower)) {
        pushDiagnostic(ctx, {
          line: lineNum,
          column: tok.column,
          endColumn: tok.column + tok.text.length,
          message: `未定義の変数 '${tok.text}' が使用されています`,
          severity: 'warning',
        })
      }
    }
  }

  return { exit: false }
}

export function analyzeTTL(source: string, options?: AnalyzeOptions): AnalysisResult {
  const lines = stripComments(source)
  const knownLabels = collectLabelNames(lines)
  const ctx: AnalysisContext = {
    diagnostics: [],
    varMap: new Map(),
    labels: new Set(),
    knownLabels,
    blockStack: [],
    includeResolver: options?.includeResolver,
    includeStack: [],
    includeTabStack: [],
    suppressDiagnostics: false,
    forLoopBlocks: createForLoopBlockList(source),
    fileUnreachable: false,
    blockUnreachableStack: [],
    fallthroughDeadStack: [],
    topLevelFallthroughDead: false,
    hasCallInFile: sourceContainsCall(lines),
    includeExchange: options?.includeExchange,
  }

  if (knownLabels.size > MAX_LABEL_COUNT) {
    ctx.diagnostics.push({
      line: 1,
      column: 0,
      message: `ラベル数が上限 ${MAX_LABEL_COUNT} を超えています（${knownLabels.size} 個）`,
      severity: 'warning',
    })
  }

  for (const name of ['timeout', 'mtimeout', 'result', 'inputstr', 'matchstr', 'paramcnt', 'params']) {
    const sysType = getSystemVariableType(name)
    ctx.varMap.set(name.toLowerCase(), {
      name,
      type:
        sysType === 'integer'
          ? 'integer'
          : sysType === 'string'
            ? 'string'
            : sysType === 'array'
              ? 'array'
              : 'unknown',
      declaredAt: 0,
      usedAt: [],
      isSystem: true,
      isUsed: false,
      arrayDeclared: sysType === 'array' ? true : undefined,
    })
  }

  if (options?.externallyDeclaredVars) {
    for (const [key, info] of options.externallyDeclaredVars) {
      if (ctx.varMap.has(key)) continue
      ctx.varMap.set(key, {
        ...cloneVariableInfo(info),
        declaredExternally: true,
        declaredInInclude: undefined,
        usedOutsideInclude: undefined,
      })
    }
  }

  for (const span of findNonAsciiOutsideLiterals(source)) {
    pushDiagnostic(ctx, {
      line: span.line,
      column: span.column,
      endColumn: span.column + span.length,
      message:
        'コメントおよび文字列リテラル以外に使用できない文字が含まれています（日本語・絵文字など。Tera Term ではエラーになります）',
      severity: 'error',
    })
  }

  analyzeLines(lines, ctx, {})

  if (options?.includeExchange) {
    for (const [key, info] of ctx.varMap) {
      if (info.declaredInInclude && info.usedOutsideInclude) {
        options.includeExchange.externallyUsed.add(key)
      }
    }
  }

  for (const block of ctx.blockStack) {
    pushDiagnostic(ctx, {
      line: block.line,
      column: 0,
      message: `'${block.keyword}' ブロックが閉じられていません`,
      severity: 'error',
    })
  }

  for (const info of ctx.varMap.values()) {
    if (
      !info.isSystem &&
      !info.isUsed &&
      info.declaredAt > 0 &&
      !info.declaredInInclude &&
      !info.declaredExternally
    ) {
      if (options?.externallyUsedNames?.has(info.name.toLowerCase())) {
        info.isUsed = true
        continue
      }
      pushDiagnostic(ctx, {
        line: info.declaredAt,
        column: 0,
        message: `変数 '${info.name}' は宣言されていますが使用されていません`,
        severity: 'info',
      })
    }
  }

  const variables = [...ctx.varMap.values()]
    .filter((v) => !v.declaredInInclude && !v.declaredExternally)
    .sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return { variables: variables, diagnostics: ctx.diagnostics }
}
