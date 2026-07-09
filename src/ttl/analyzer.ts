import {
  OUTPUT_COMMANDS,
  TTL_COMMANDS,
  getSystemVariableType,
  isSystemVariable,
} from './commands'
import { checkCommandArgs } from './argChecker'
import { normalizeIncludePath } from './includeRefs'
import { RESERVED, tokenizeLine, stripComments, getStringLiteralError, unquoteString } from './tokenize'

export type VarType = 'integer' | 'string' | 'array' | 'unknown'

export interface VariableInfo {
  name: string
  type: VarType
  declaredAt: number
  usedAt: number[]
  isSystem: boolean
  isUsed: boolean
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
  /** インクルード先の行に対する診断を抑制（親タブのリントと行番号がずれるため） */
  suppressDiagnostics: boolean
}

interface LineLoopResult {
  exit: boolean
  end: boolean
}

function inferTypeFromValue(text: string): VarType {
  if (text.startsWith("'") || text.startsWith('"')) return 'string'
  if (/^-?\d+(\.\d+)?$/.test(text)) return 'integer'
  return 'unknown'
}

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

const BLOCK_PAIRS: [string, string][] = [
  ['if', 'endif'],
  ['while', 'endwhile'],
  ['for', 'next'],
  ['do', 'loop'],
  ['until', 'enduntil'],
]

function pushDiagnostic(ctx: AnalysisContext, diag: Diagnostic): void {
  if (!ctx.suppressDiagnostics) ctx.diagnostics.push(diag)
}

function analyzeLines(lines: string[], ctx: AnalysisContext, loopOpts: { stopOnExit?: boolean }): LineLoopResult {
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
      const arg = tokens[1]
      if (arg?.kind === 'string') {
        const path = unquoteString(arg.text)
        const key = normalizeIncludePath(path)
        if (ctx.includeStack.includes(key)) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: first.column,
            message: `循環 include が検出されました: '${path}'`,
            severity: 'error',
          })
        } else if (ctx.includeResolver) {
          const content = ctx.includeResolver.resolve(path)
          if (content) {
            ctx.includeStack.push(key)
            const childResult = analyzeLines(stripComments(content), ctx, { stopOnExit: true })
            ctx.includeStack.pop()
            if (childResult.end) return { exit: false, end: true }
          } else if (!ctx.suppressDiagnostics) {
            pushDiagnostic(ctx, {
              line: lineNum,
              column: first.column,
              message: `include '${path}' がタブにリンクされていないため、内容は解析に含まれません`,
              severity: 'info',
            })
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

    if (cmd === 'goto') {
      const target = tokens[1]
      if (target?.kind === 'label' || (target?.kind === 'identifier' && tokens[1]?.text.startsWith(':'))) {
        // ok
      } else if (target?.kind === 'identifier') {
        const labelRef = target.text.replace(/^:/, '').toLowerCase()
        if (!ctx.labels.has(labelRef)) {
          pushDiagnostic(ctx, {
            line: lineNum,
            column: target.column,
            message: `ラベル ':${target.text}' が定義されていません`,
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

      const existing = ctx.varMap.get(varKey)
      const effectiveType: VarType = isArrayAssign ? 'array' : newType

      if (existing && !existing.isSystem && existing.type !== 'unknown' && effectiveType !== 'unknown' && existing.type !== effectiveType && !(existing.type === 'array' && isArrayAssign)) {
        pushDiagnostic(ctx, {
          line: lineNum,
          column: tokens.find((t) => t.kind === 'identifier' && t.text.toLowerCase() === varKey)!.column,
          message: `変数 '${assignVarName}' の型が ${existing.type} から ${effectiveType} に変更されています（TTLでは型変更不可）`,
          severity: 'error',
        })
      } else if (!existing) {
        ctx.varMap.set(varKey, {
          name: assignVarName,
          type: effectiveType,
          declaredAt: lineNum,
          usedAt: [],
          isSystem: isSystemVariable(assignVarName),
          isUsed: false,
        })
      } else if (existing.type === 'unknown' && effectiveType !== 'unknown') {
        existing.type = effectiveType
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
        existing.usedAt.push(lineNum)
        existing.isUsed = true
      }
    }

    if ((cmd === 'strdim' || cmd === 'intdim') && tokens[1]?.kind === 'identifier') {
      const varName = tokens[1].text
      const varKey = varName.toLowerCase()
      if (!ctx.varMap.has(varKey)) {
        ctx.varMap.set(varKey, {
          name: varName,
          type: 'array',
          declaredAt: lineNum,
          usedAt: [],
          isSystem: false,
          isUsed: false,
        })
      } else {
        ctx.varMap.get(varKey)!.type = 'array'
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
    suppressDiagnostics: false,
  }

  for (const name of ['timeout', 'mtimeout', 'result', 'inputstr', 'matchstr', 'paramcnt']) {
    const sysType = getSystemVariableType(name)
    ctx.varMap.set(name.toLowerCase(), {
      name,
      type: sysType === 'integer' ? 'integer' : sysType === 'string' ? 'string' : 'unknown',
      declaredAt: 0,
      usedAt: [],
      isSystem: true,
      isUsed: false,
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
