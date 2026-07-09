import {
  OUTPUT_COMMANDS,
  TTL_COMMANDS,
  getSystemVariableType,
  isSystemVariable,
} from './commands'
import { checkCommandArgs } from './argChecker'
import {
  createForLoopBlockList,
  extractIncludeArgText,
  getLoopContextForLine,
  includeDynamicBindingKey,
  includeLoopIterationBindingKey,
  normalizeIncludePath,
  type IncludeResolveContext,
  type ForLoopBlock,
} from './includeRefs'
import { RESERVED, tokenizeLine, stripComments, getStringLiteralError, unquoteString, type Token } from './tokenize'

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
  getLinkedTabId(bindingKey: string, rawArg?: string): string | null
  /** インクルード先タブ用の resolver（ネストした include 用） */
  resolverForLinkedTab(tabId: string): IncludeResolver | null
}

export interface AnalyzeOptions {
  includeResolver?: IncludeResolver
  /** 他タブ（include 元）での使用として扱う変数名 */
  externallyUsedNames?: ReadonlySet<string>
}

interface AnalysisContext {
  diagnostics: Diagnostic[]
  varMap: Map<string, VariableInfo>
  labels: Set<string>
  blockStack: { keyword: string; line: number }[]
  includeResolver?: IncludeResolver
  includeStack: string[]
  /** インクルード先タブ ID のスタック（同一タブへの別キー経由の循環検出） */
  includeTabStack: string[]
  /** インクルード先の行に対する診断を抑制（親タブのリントと行番号がずれるため） */
  suppressDiagnostics: boolean
  forLoopBlocks: ForLoopBlock[]
}

interface LineLoopResult {
  exit: boolean
  end: boolean
}

interface LineLoopOpts {
  stopOnExit?: boolean
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
    return
  }
  info.constantValue = resolveStaticInteger(valueToken, varMap)
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

function markVariableUsed(ctx: AnalysisContext, lineNum: number, name: string): void {
  const lower = name.toLowerCase()
  if (RESERVED.has(lower)) return
  const info = ctx.varMap.get(lower)
  if (info) {
    info.usedAt.push(lineNum)
    info.isUsed = true
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
): void {
  if (ctx.includeStack.includes(bindingKey)) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: first.column,
      message: `循環 include が検出されました: L${lineNum}`,
      severity: 'error',
    })
    return
  }
  const linkedTabId = content ? ctx.includeResolver!.getLinkedTabId(bindingKey, rawArg) : null
  if (linkedTabId && ctx.includeTabStack.includes(linkedTabId)) {
    pushDiagnostic(ctx, {
      line: lineNum,
      column: first.column,
      message: `循環 include が検出されました（同一タブの再参照）: L${lineNum}`,
      severity: 'error',
    })
    return
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
    return
  }

  ctx.includeStack.push(bindingKey)
  if (linkedTabId) ctx.includeTabStack.push(linkedTabId)
  const childResolver = linkedTabId
    ? ctx.includeResolver!.resolverForLinkedTab(linkedTabId) ?? ctx.includeResolver!
    : ctx.includeResolver!
  const childCtx: AnalysisContext = {
    ...ctx,
    includeResolver: childResolver,
    blockStack: [...ctx.blockStack],
  }
  analyzeLines(stripComments(content), childCtx, { stopOnExit: true })
  ctx.includeStack.pop()
  if (linkedTabId) ctx.includeTabStack.pop()
}

function pushDiagnostic(ctx: AnalysisContext, diag: Diagnostic): void {
  if (!ctx.suppressDiagnostics) ctx.diagnostics.push(diag)
}

function analyzeLines(lines: string[], ctx: AnalysisContext, loopOpts: LineLoopOpts): LineLoopResult {
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1
    const line = lines[lineIdx]!
    const tokens = tokenizeLine(line, lineNum)

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
          analyzeResolvedInclude(ctx, lineNum, first, bindingKey, content, notLinkedMessage)
        } else {
          const rawArg = extractIncludeArgText(tokens, 0)
          const argLabel = rawArg || '（引数）'
          const notLinkedMessage = `include ${argLabel}（変数指定）がタブにリンクされていないため、内容は解析に含まれません`
          const loopCtx = getLoopContextForLine(ctx.forLoopBlocks, lineNum)
          if (loopCtx) {
            for (const v of loopCtx.values) {
              const bindingKey = includeLoopIterationBindingKey(lineNum, v)
              const content = ctx.includeResolver.resolveDynamic(rawArg, { line: lineNum, loopValue: v })
              analyzeResolvedInclude(ctx, lineNum, first, bindingKey, content, notLinkedMessage, rawArg)
            }
          } else {
            const bindingKey = includeDynamicBindingKey(rawArg)
            const content = ctx.includeResolver.resolveDynamic(rawArg)
            analyzeResolvedInclude(ctx, lineNum, first, bindingKey, content, notLinkedMessage, rawArg)
          }
        }
      }
      continue
    }

    if (cmd === 'exit') {
      if (loopOpts.stopOnExit) return { exit: true, end: false }
      return { exit: false, end: true }
    }

    if (cmd === 'end') {
      return { exit: false, end: true }
    }

    for (const [open, close] of BLOCK_PAIRS) {
      if (cmd === open) {
        ctx.blockStack.push({ keyword: open, line: lineNum })
      }
      if (cmd === close) {
        const last = ctx.blockStack.pop()
        if (!last || last.keyword !== open) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: first.column,
            message: `'${first.text}' に対応する開始ブロックがありません`,
            severity: 'error',
          })
        }
      }
    }

    if (cmd === 'goto' || cmd === 'call') {
      const target = tokens[1]
      if (target?.kind === 'label' || (target?.kind === 'identifier' && target.text.startsWith(':'))) {
        // ok
      } else if (target?.kind === 'identifier') {
        const labelRef = target.text.replace(/^:/, '').toLowerCase()
        if (!ctx.labels.has(labelRef)) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: target.column,
            message: `ラベル ':${target.text.replace(/^:/, '')}' が定義されていません`,
            severity: 'warning',
          })
        }
      }
    }

    const assignIdx = tokens.findIndex(
      (t, i) => i > 0 && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
    )

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
          const info: VariableInfo = {
            name: assignVarName,
            type: effectiveType,
            declaredAt: lineNum,
            usedAt: [],
            isSystem: isSystemVariable(assignVarName),
            isUsed: false,
          }
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
        ctx.varMap.set(varKey, {
          name: varName,
          type: 'integer',
          declaredAt: lineNum,
          usedAt: [lineNum],
          isSystem: false,
          isUsed: true,
        })
      } else {
        existing.type = existing.type === 'unknown' ? 'integer' : existing.type
        existing.constantValue = undefined
        existing.usedAt.push(lineNum)
        existing.isUsed = true
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
        ctx.varMap.set(varKey, {
          name: varName,
          type: 'array',
          declaredAt: lineNum,
          usedAt: [],
          isSystem: false,
          isUsed: false,
          arrayDeclared: true,
          arraySize: staticSize,
          arrayElementType: elementType,
        })
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

    if (OUTPUT_COMMANDS.has(cmd) && tokens[1]?.kind === 'identifier') {
      const varName = tokens[1].text
      const varKey = varName.toLowerCase()
      if (!ctx.varMap.has(varKey)) {
        ctx.varMap.set(varKey, {
          name: varName,
          type: 'unknown',
          declaredAt: lineNum,
          usedAt: [],
          isSystem: isSystemVariable(varName),
          isUsed: false,
        })
      }
    }

    const assignVarKey = assignVarName?.toLowerCase() ?? null
    const arrayAssignName = assignIdx > 0 ? isArrayAssignTarget(tokens, assignIdx) : null

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!
      if (tok.kind !== 'identifier') continue

      const lower = tok.text.toLowerCase()
      if (RESERVED.has(lower)) continue
      if (OUTPUT_COMMANDS.has(cmd) && i === 1) continue
      if (cmd === 'for' && i === 1) continue
      if ((cmd === 'strdim' || cmd === 'intdim') && i === 1) continue
      if ((cmd === 'goto' || cmd === 'call') && i === 1) continue

      if (i > 0 && tokens[i - 1]?.text === '[' && tokens[i + 1]?.text === ']') {
        const info = ctx.varMap.get(lower)
        if (info) {
          info.usedAt.push(lineNum)
          info.isUsed = true
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
          info.usedAt.push(lineNum)
          info.isUsed = true
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
        info.usedAt.push(lineNum)
        info.isUsed = true
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

  return { exit: false, end: false }
}

export function analyzeTTL(source: string, options?: AnalyzeOptions): AnalysisResult {
  const lines = stripComments(source)
  const ctx: AnalysisContext = {
    diagnostics: [],
    varMap: new Map(),
    labels: new Set(),
    blockStack: [],
    includeResolver: options?.includeResolver,
    includeStack: [],
    includeTabStack: [],
    suppressDiagnostics: false,
    forLoopBlocks: createForLoopBlockList(source),
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

  const { end } = analyzeLines(lines, ctx, {})
  if (!end) {
    for (const block of ctx.blockStack) {
      pushDiagnostic(ctx, {
        line: block.line,
        column: 0,
        message: `'${block.keyword}' ブロックが閉じられていません`,
        severity: 'error',
      })
    }
  }

  for (const info of ctx.varMap.values()) {
    if (!info.isSystem && !info.isUsed && info.declaredAt > 0) {
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

  const variables = [...ctx.varMap.values()].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return { variables: variables, diagnostics: ctx.diagnostics }
}
