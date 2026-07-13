import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import {
  CONTROL_KEYWORDS,
  LOGICAL_OPERATORS,
  SYSTEM_VARIABLES,
  TTL_COMMANDS,
} from './commands'
import { analyzeTTL } from './analyzer'
import { getCachedAnalysis, getIncludeCrossTabContext, getIncludeResolver } from './analysisContext'
import { collectLabelNames } from './labels'
import { tokenizeLine } from './tokenize'

const KEYWORDS = new Set([...CONTROL_KEYWORDS, ...LOGICAL_OPERATORS, 'then'])

const COMMAND_ITEMS: Completion[] = [...TTL_COMMANDS]
  .sort()
  .map((label) => ({ label, type: 'function', detail: 'TTLコマンド' }))

const KEYWORD_ITEMS: Completion[] = [...KEYWORDS]
  .sort()
  .map((label) => ({ label, type: 'keyword', detail: 'キーワード' }))

const SYSTEM_VAR_ITEMS: Completion[] = Object.keys(SYSTEM_VARIABLES)
  .sort()
  .map((label) => ({
    label,
    type: 'variable',
    detail: `システム変数 (${SYSTEM_VARIABLES[label]})`,
    boost: -1,
  }))

function matchesPrefix(label: string, prefix: string): boolean {
  if (!prefix) return true
  return label.toLowerCase().startsWith(prefix.toLowerCase())
}

function isInsideString(line: string, col: number): boolean {
  let quote: string | null = null
  for (let i = 0; i < col && i < line.length; i++) {
    const ch = line[i]!
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') {
      quote = ch
    }
  }
  return quote !== null
}

function statementStartColumn(line: string): number {
  const leading = line.match(/^\s*/)?.[0].length ?? 0
  const labelMatch = line.slice(leading).match(/^:\w+/)
  let pos = leading + (labelMatch?.[0].length ?? 0)
  while (pos < line.length && /\s/.test(line[pos]!)) pos++
  return pos
}

type LineCompletionMode = 'start' | 'variable' | 'label'

function getLineCompletionMode(line: string, lineNum: number, col: number): LineCompletionMode | null {
  if (isInsideString(line, col)) return null

  const tokens = tokenizeLine(line, lineNum)
  let stmt = 0
  if (tokens[0]?.kind === 'label') stmt = 1

  const cursorToken = tokens.find((t) => col > t.column && col <= t.column + t.text.length)
  const cursorIdx = cursorToken ? tokens.indexOf(cursorToken) : tokens.length

  const prevToken = [...tokens].filter((t) => t.column + t.text.length <= col).pop()
  const stmtCmd = tokens[stmt]?.kind === 'identifier' ? tokens[stmt].text.toLowerCase() : ''
  if (stmtCmd === 'goto' || stmtCmd === 'call') {
    if (cursorIdx === stmt + 1 || prevToken?.text.toLowerCase() === stmtCmd) {
      return 'label'
    }
  }

  const hasAssign = tokens.some((t) => t.kind === 'operator' && (t.text === '=' || t.text === ':='))
  const startCol = statementStartColumn(line)
  const atStatementStart =
    col <= startCol ||
    cursorIdx === stmt ||
    (cursorIdx === stmt + 1 && cursorToken === undefined && !hasAssign)

  if (atStatementStart && !hasAssign) return 'start'
  return 'variable'
}

function collectLabels(source: string): string[] {
  return [...collectLabelNames(source)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

function collectUserVariables(source: string): Completion[] {
  const crossTab = getIncludeCrossTabContext()
  const result =
    getCachedAnalysis(source) ??
    analyzeTTL(source, {
      includeResolver: getIncludeResolver(),
      externallyUsedNames: crossTab?.externallyUsed,
      externallyDeclaredVars: crossTab?.externallyDeclared,
    })
  return result.variables
    .filter((v) => !v.isSystem)
    .map((v) => ({
      label: v.name,
      type: 'variable',
      detail: `変数 (${v.type})`,
      boost: 2,
    }))
}

function filterOptions(options: Completion[], prefix: string): Completion[] {
  return options.filter((o) => matchesPrefix(o.label, prefix))
}

function ttlCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[a-zA-Z_]\w*/)
  if (!word) return null

  const lineObj = context.state.doc.lineAt(context.pos)
  const col = context.pos - lineObj.from
  const mode = getLineCompletionMode(lineObj.text, lineObj.number, col)
  if (!mode) return null

  const prefix = word.text
  const from = word.from
  const source = context.state.doc.toString()
  const options: Completion[] = []

  if (mode === 'start') {
    options.push(...filterOptions(COMMAND_ITEMS, prefix))
    options.push(...filterOptions(KEYWORD_ITEMS, prefix))
  }

  if (mode === 'start' || mode === 'variable') {
    const userVars = collectUserVariables(source)
    const seen = new Set<string>()
    for (const item of [...userVars, ...SYSTEM_VAR_ITEMS]) {
      const key = item.label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (matchesPrefix(item.label, prefix)) options.push(item)
    }
  }

  if (mode === 'label') {
    for (const label of collectLabels(source)) {
      if (matchesPrefix(label, prefix)) {
        options.push({ label, type: 'label', detail: 'ラベル' })
      }
    }
  }

  if (options.length === 0) return null

  options.sort((a, b) => {
    const boostA = a.boost ?? 0
    const boostB = b.boost ?? 0
    if (boostA !== boostB) return boostB - boostA
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })

  return { from, options, validFor: /^\w*$/ }
}

export const ttlAutocompletion = autocompletion({
  activateOnTyping: true,
  defaultKeymap: false,
  icons: true,
  maxRenderedOptions: 40,
  override: [ttlCompletionSource],
})
