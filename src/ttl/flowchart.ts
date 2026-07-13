import type { IncludeResolver } from './analyzer'
import { isAssignmentLine } from './argChecker'
import {
  computeLoopIncludeEffectiveRaw,
  collectStaticStringArrayValues,
  createForLoopBlockList,
  extractIncludeArgText,
  getForLoopBlockForLine,
  getLoopContextForLine,
  includeDynamicBindingKey,
  normalizeIncludePath,
  resolveLoopIncludeBindingKey,
} from './includeRefs'
import { collectLabelLineMap, labelNameFromToken } from './labels'
import {
  findIfThenTailStart,
  findSingleLineIfTailStart,
  resolveJumpLabelName,
} from './subroutine'
import { stripComments, tokenizeLine, unquoteString, type Token } from './tokenize'

export type FlowchartNodeKind =
  | 'entry'
  | 'exit'
  | 'process'
  | 'assignment'
  | 'decision'
  | 'loop'
  | 'io'
  | 'dialog'
  | 'jump'
  | 'include'
  | 'terminal'
  | 'warning'

export type FlowchartEdgeKind =
  | 'flow'
  | 'true'
  | 'false'
  | 'loop'
  | 'jump'
  | 'call'
  | 'return'
  | 'include'

export interface FlowchartNode {
  id: string
  sourceId: string
  sourceName: string
  line: number
  endLine: number
  location: string
  kind: FlowchartNodeKind
  label: string
  detail?: string
}

export interface FlowchartEdge {
  id: string
  source: string
  target: string
  kind: FlowchartEdgeKind
  label?: string
}

export interface FlowchartModel {
  rootSourceId: string
  nodes: FlowchartNode[]
  edges: FlowchartEdge[]
  warnings: string[]
}

export interface BuildFlowchartOptions {
  sourceId: string
  sourceName: string
  includeResolver?: IncludeResolver
  getSourceName?: (sourceId: string) => string | undefined
  maxIncludeDepth?: number
  /** wait / waitln / waitregex / wait4all / waitrecv / recvln を表示する */
  showDetailedWaits?: boolean
  /** 変数への代入を表示する */
  showAssignments?: boolean
}

interface Statement {
  line: number
  text: string
  tokens: Token[]
  offset: number
  cmd: string
}

interface FileGraph {
  entryId: string
  exitId: string
  nodes: FlowchartNode[]
  edges: FlowchartEdge[]
  warnings: string[]
}

const IO_COMMANDS = new Set([
  'send',
  'sendln',
  'connect',
  'disconnect',
  'flushrecv',
])

const OPTIONAL_WAIT_COMMANDS = new Set(['wait', 'waitln', 'waitregex', 'wait4all', 'waitrecv', 'recvln'])

const DIALOG_COMMANDS = new Set([
  'inputbox',
  'passwordbox',
  'yesnobox',
  'messagebox',
  'listbox',
  'filenamebox',
  'dirnamebox',
  'statusbox',
])

const BLOCK_CLOSE: Record<string, string> = {
  if: 'endif',
  for: 'next',
  while: 'endwhile',
  do: 'loop',
  until: 'enduntil',
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function commandAt(tokens: Token[], offset: number): string {
  const token = tokens[offset]
  return token?.kind === 'identifier' ? token.text.toLowerCase() : ''
}

function collectStatements(source: string): Statement[] {
  return stripComments(source)
    .map((text, index): Statement | null => {
      const tokens = tokenizeLine(text, index + 1)
      if (tokens.length === 0) return null
      const offset = tokens[0]?.kind === 'label' ? 1 : 0
      const cmd = commandAt(tokens, offset)
      if (!cmd && tokens[0]?.kind !== 'label') return null
      return { line: index + 1, text: text.trim(), tokens, offset, cmd }
    })
    .filter((statement): statement is Statement => statement !== null)
}

function classify(statement: Statement, showDetailedWaits: boolean): FlowchartNodeKind {
  const { cmd, tokens } = statement
  if (cmd === 'if' || cmd === 'elseif' || cmd === 'else') return 'decision'
  if (['for', 'next', 'while', 'endwhile', 'do', 'loop', 'until', 'enduntil', 'break', 'continue'].includes(cmd)) {
    return 'loop'
  }
  if (IO_COMMANDS.has(cmd)) return 'io'
  if (showDetailedWaits && OPTIONAL_WAIT_COMMANDS.has(cmd)) return 'io'
  if (DIALOG_COMMANDS.has(cmd)) return 'dialog'
  if (cmd === 'goto' || cmd === 'call' || cmd === 'return') return 'jump'
  if (cmd === 'include') return 'include'
  if (cmd === 'end' || cmd === 'exit') return 'terminal'
  if (tokens[0]?.kind === 'label') return 'jump'
  return 'process'
}

function statementDisplayKind(statement: Statement, showDetailedWaits: boolean): FlowchartNodeKind {
  const kind = classify(statement, showDetailedWaits)
  if (kind === 'process' && isAssignmentLine(statement.tokens)) return 'assignment'
  return kind
}

function shortText(text: string, max = 64): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function statementLabel(statement: Statement): string {
  const label = statement.tokens[0]?.kind === 'label' ? `${statement.tokens[0].text}: ` : ''
  return shortText(`${label}${statement.text.replace(/^:[^\s]+\s*/, '')}`)
}

function makeNodes(
  statements: Statement[],
  sourceId: string,
  sourceName: string,
  instanceId: string,
  showDetailedWaits: boolean,
): { nodes: FlowchartNode[]; lineToNode: Map<number, string> } {
  const nodes: FlowchartNode[] = []
  const lineToNode = new Map<number, string>()
  const prefix = safeIdPart(instanceId)

  for (let index = 0; index < statements.length; index++) {
    const first = statements[index]!
    const kind = statementDisplayKind(first, showDetailedWaits)
    const group = [first]
    if ((kind === 'process' || kind === 'assignment') && first.tokens[0]?.kind !== 'label') {
      while (index + 1 < statements.length) {
        const next = statements[index + 1]!
        const nextKind = statementDisplayKind(next, showDetailedWaits)
        if (nextKind !== kind || next.tokens[0]?.kind === 'label') break
        group.push(next)
        index++
      }
    }
    const id = `${prefix}-L${first.line}`
    const last = group[group.length - 1]!
    const label =
      group.length === 1
        ? statementLabel(first)
        : `${statementLabel(first)}\n…\n${statementLabel(last)}`
    const node: FlowchartNode = {
      id,
      sourceId,
      sourceName,
      line: first.line,
      endLine: last.line,
      location: `${sourceId}:L${first.line}`,
      kind,
      label,
      detail: group.length > 1 ? `L${first.line}–L${last.line}（${group.length}処理）` : undefined,
    }
    nodes.push(node)
    for (const statement of group) lineToNode.set(statement.line, id)
  }
  return { nodes, lineToNode }
}

function findMatchingStatement(
  statements: Statement[],
  startIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0
  for (let index = startIndex + 1; index < statements.length; index++) {
    const cmd = statements[index]!.cmd
    if (cmd === open) depth++
    if (cmd !== close) continue
    if (depth === 0) return index
    depth--
  }
  return -1
}

function findIfSiblings(statements: Statement[], startIndex: number, endIndex: number): number[] {
  const siblings: number[] = []
  let depth = 0
  for (let index = startIndex + 1; index < endIndex; index++) {
    const cmd = statements[index]!.cmd
    if (cmd === 'if' && !isSingleLineIf(statements[index]!)) depth++
    if (cmd === 'endif') {
      depth--
      continue
    }
    if (depth === 0 && (cmd === 'elseif' || cmd === 'else')) siblings.push(index)
  }
  return siblings
}

function isSingleLineIf(statement: Statement): boolean {
  if (statement.cmd !== 'if') return false
  return (
    findIfThenTailStart(statement.tokens, statement.offset) !== null ||
    findSingleLineIfTailStart(statement.tokens, statement.offset) !== null
  )
}

function addEdge(
  edges: FlowchartEdge[],
  source: string | undefined,
  target: string | undefined,
  kind: FlowchartEdgeKind,
  label?: string,
): void {
  if (!source || !target) return
  const duplicate = edges.some(
    (edge) => edge.source === source && edge.target === target && edge.kind === kind && edge.label === label,
  )
  if (duplicate) return
  edges.push({
    id: `${source}--${target}--${kind}--${safeIdPart(label ?? '')}`,
    source,
    target,
    kind,
    label,
  })
}

function removeOutgoing(edges: FlowchartEdge[], source: string): void {
  for (let index = edges.length - 1; index >= 0; index--) {
    if (edges[index]!.source === source) edges.splice(index, 1)
  }
}

/** 表示情報を通信・送受信・制御フローに絞り、省略ノードの前後を直結する */
function compactForDisplay(model: FlowchartModel, showAssignments = false): FlowchartModel {
  const nodes = [...model.nodes]
  const edges = [...model.edges]
  const removableIds = nodes
    .filter((node) => {
      if (node.kind === 'process' || node.kind === 'dialog') return true
      if (node.kind === 'assignment') return !showAssignments
      return false
    })
    .map((node) => node.id)

  for (const nodeId of removableIds) {
    const incoming = edges.filter((edge) => edge.target === nodeId && edge.source !== nodeId)
    const outgoing = edges.filter((edge) => edge.source === nodeId && edge.target !== nodeId)
    for (let index = edges.length - 1; index >= 0; index--) {
      if (edges[index]!.source === nodeId || edges[index]!.target === nodeId) edges.splice(index, 1)
    }
    for (const before of incoming) {
      for (const after of outgoing) {
        if (before.source === after.target) continue
        const keepIncomingMeaning = before.kind !== 'flow'
        addEdge(
          edges,
          before.source,
          after.target,
          keepIncomingMeaning ? before.kind : after.kind,
          keepIncomingMeaning ? before.label : after.label,
        )
      }
    }
  }

  const removed = new Set(removableIds)
  return {
    ...model,
    nodes: nodes.filter((node) => !removed.has(node.id)),
    edges,
  }
}

function buildFileGraph(
  source: string,
  sourceId: string,
  sourceName: string,
  instanceId: string,
  resolver: IncludeResolver | undefined,
  options: BuildFlowchartOptions,
  includeStack: string[],
  globalExitId?: string,
): FileGraph {
  const statements = collectStatements(source)
  const prefix = safeIdPart(instanceId)
  const entryId = `${prefix}-entry`
  const exitId = `${prefix}-exit`
  const built = makeNodes(
    statements,
    sourceId,
    sourceName,
    instanceId,
    options.showDetailedWaits ?? false,
  )
  const effectiveGlobalExitId = globalExitId ?? exitId
  const nodes: FlowchartNode[] = [
    {
      id: entryId,
      sourceId,
      sourceName,
      line: 1,
      endLine: 1,
      location: `${sourceId}:L1`,
      kind: 'entry',
      label: `${sourceName}\n開始`,
    },
    ...built.nodes,
    {
      id: exitId,
      sourceId,
      sourceName,
      line: Math.max(1, stripComments(source).length),
      endLine: Math.max(1, stripComments(source).length),
      location: `${sourceId}:L${Math.max(1, stripComments(source).length)}`,
      kind: 'exit',
      label: `${sourceName}\n終了`,
    },
  ]
  const edges: FlowchartEdge[] = []
  const warnings: string[] = []
  const nodeIds = built.nodes.map((node) => node.id)
  addEdge(edges, entryId, nodeIds[0] ?? exitId, 'flow')
  for (let index = 0; index < nodeIds.length; index++) {
    addEdge(edges, nodeIds[index], nodeIds[index + 1] ?? exitId, 'flow')
  }

  const labels = collectLabelLineMap(stripComments(source))
  const nodeForStatement = (index: number): string | undefined => {
    const statement = statements[index]
    return statement ? built.lineToNode.get(statement.line) : undefined
  }
  const nodeAfterStatement = (index: number): string => nodeForStatement(index + 1) ?? exitId
  const labelTarget = (token: Token | undefined): string | undefined => {
    const label = resolveJumpLabelName(token) ?? labelNameFromToken(token)
    const line = label ? labels.get(label.toLowerCase()) : undefined
    return line ? built.lineToNode.get(line) : undefined
  }

  const loopRanges: Array<{ start: number; end: number; cmd: string }> = []
  const ifRanges: Array<{ start: number; end: number; siblings: number[] }> = []
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]!
    const close = BLOCK_CLOSE[statement.cmd]
    if (!close || (statement.cmd === 'if' && isSingleLineIf(statement))) continue
    const end = findMatchingStatement(statements, index, statement.cmd, close)
    if (end >= 0 && statement.cmd !== 'if') loopRanges.push({ start: index, end, cmd: statement.cmd })
    if (end >= 0 && statement.cmd === 'if') {
      ifRanges.push({ start: index, end, siblings: findIfSiblings(statements, index, end) })
    }
  }

  const afterIfBlock = (endIndex: number): string => {
    let effectiveEnd = endIndex
    while (true) {
      const parent = ifRanges.find(
        (range) =>
          range.start < effectiveEnd &&
          effectiveEnd < range.end &&
          range.siblings.includes(effectiveEnd + 1),
      )
      if (!parent) return nodeAfterStatement(effectiveEnd)
      effectiveEnd = parent.end
    }
  }

  const callRecords: Array<{ targetLine: number; successor: string }> = []

  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]!
    const nodeId = nodeForStatement(index)
    if (!nodeId) continue

    if (statement.cmd === 'goto' || statement.cmd === 'call') {
      const targetToken = statement.tokens[statement.offset + 1]
      const target = labelTarget(targetToken)
      removeOutgoing(edges, nodeId)
      if (target) addEdge(edges, nodeId, target, statement.cmd === 'call' ? 'call' : 'jump', statement.cmd)
      else warnings.push(`${sourceName}:L${statement.line} ${statement.cmd} の移動先を解決できません`)
      if (statement.cmd === 'call') {
        const label = resolveJumpLabelName(targetToken) ?? labelNameFromToken(targetToken)
        const targetLine = label ? labels.get(label.toLowerCase()) : undefined
        if (targetLine) callRecords.push({ targetLine, successor: nodeAfterStatement(index) })
      }
      continue
    }

    if (statement.cmd === 'return') {
      removeOutgoing(edges, nodeId)
      addEdge(edges, nodeId, exitId, 'return', 'return')
      continue
    }

    if (statement.cmd === 'end' || statement.cmd === 'exit') {
      removeOutgoing(edges, nodeId)
      addEdge(edges, nodeId, statement.cmd === 'end' ? effectiveGlobalExitId : exitId, 'flow', statement.cmd)
      continue
    }

    if (statement.cmd === 'if' && isSingleLineIf(statement)) {
      removeOutgoing(edges, nodeId)
      const tail =
        findIfThenTailStart(statement.tokens, statement.offset)?.tailStart ??
        findSingleLineIfTailStart(statement.tokens, statement.offset)
      const tailCmd = tail === null ? '' : commandAt(statement.tokens, tail)
      if (tailCmd === 'goto' || tailCmd === 'call') {
        const target = labelTarget(statement.tokens[(tail ?? 0) + 1])
        addEdge(edges, nodeId, target, tailCmd === 'call' ? 'call' : 'jump', '真')
      } else if (tailCmd === 'break' || tailCmd === 'continue') {
        const loop = [...loopRanges]
          .reverse()
          .find((range) => range.cmd !== 'do' && range.start < index && index < range.end)
        addEdge(
          edges,
          nodeId,
          loop
            ? tailCmd === 'break'
              ? nodeAfterStatement(loop.end)
              : nodeForStatement(loop.start)
            : nodeAfterStatement(index),
          tailCmd === 'continue' ? 'loop' : 'false',
          tailCmd,
        )
      } else {
        addEdge(edges, nodeId, nodeAfterStatement(index), 'true', '真')
      }
      addEdge(edges, nodeId, nodeAfterStatement(index), 'false', '偽')
      continue
    }

    if (statement.cmd === 'if') {
      const end = findMatchingStatement(statements, index, 'if', 'endif')
      if (end < 0) continue
      const siblings = findIfSiblings(statements, index, end)
      const after = afterIfBlock(end)
      const branchHeaders = [index, ...siblings]
      for (let branch = 0; branch < branchHeaders.length; branch++) {
        const headerIndex = branchHeaders[branch]!
        const header = statements[headerIndex]!
        const headerNode = nodeForStatement(headerIndex)
        const nextHeaderIndex = branchHeaders[branch + 1] ?? end
        if (!headerNode) continue
        removeOutgoing(edges, headerNode)
        addEdge(edges, headerNode, nodeForStatement(headerIndex + 1) ?? after, 'true', header.cmd === 'else' ? 'その他' : '真')
        if (header.cmd !== 'else') {
          addEdge(edges, headerNode, nodeForStatement(nextHeaderIndex) ?? after, 'false', '偽')
        }
        const bodyLast = nodeForStatement(nextHeaderIndex - 1)
        if (bodyLast && bodyLast !== headerNode) {
          removeOutgoing(edges, bodyLast)
          addEdge(edges, bodyLast, after, 'flow')
        }
      }
      continue
    }

    const close = BLOCK_CLOSE[statement.cmd]
    if (close && statement.cmd !== 'if') {
      const end = findMatchingStatement(statements, index, statement.cmd, close)
      if (end < 0) continue
      const closeNode = nodeForStatement(end)
      const after = nodeAfterStatement(end)
      const bodyStart = nodeForStatement(index + 1) ?? closeNode
      if (statement.cmd === 'until') {
        for (const edge of edges) {
          if (edge.target === nodeId && edge.kind === 'flow') edge.target = bodyStart ?? nodeId
        }
        removeOutgoing(edges, nodeId)
        addEdge(edges, nodeId, after, 'true', '真: 終了')
        addEdge(edges, nodeId, bodyStart, 'false', '偽: 反復')
        if (closeNode) {
          removeOutgoing(edges, closeNode)
          addEdge(edges, closeNode, nodeId, 'loop', '条件判定')
        }
      } else if (statement.cmd === 'do') {
        removeOutgoing(edges, nodeId)
        addEdge(edges, nodeId, bodyStart, 'flow', '実行')
        if (closeNode) {
          removeOutgoing(edges, closeNode)
          const hasWhile = statements[end]!.tokens.some(
            (token, tokenIndex) =>
              tokenIndex > statements[end]!.offset &&
              token.kind === 'identifier' &&
              token.text.toLowerCase() === 'while',
          )
          addEdge(edges, closeNode, nodeId, 'loop', hasWhile ? '真: 反復' : '反復')
          if (hasWhile) addEdge(edges, closeNode, after, 'false', '偽: 終了')
        }
      } else {
        removeOutgoing(edges, nodeId)
        addEdge(edges, nodeId, bodyStart, 'true', '真')
        addEdge(edges, nodeId, after, 'false', '偽')
        if (closeNode) {
          removeOutgoing(edges, closeNode)
          addEdge(edges, closeNode, nodeId, 'loop', '反復')
        }
      }
      continue
    }

    if (statement.cmd === 'break' || statement.cmd === 'continue') {
      const loop = [...loopRanges]
        .reverse()
        .find((range) => range.cmd !== 'do' && range.start < index && index < range.end)
      if (!loop) continue
      removeOutgoing(edges, nodeId)
      addEdge(
        edges,
        nodeId,
        statement.cmd === 'break' ? nodeAfterStatement(loop.end) : nodeForStatement(loop.start),
        statement.cmd === 'break' ? 'false' : 'loop',
        statement.cmd,
      )
    }
  }

  const callTargetLines = new Set(callRecords.map((call) => call.targetLine))
  const returnTargets = new Map<string, Set<string>>()
  for (const call of callRecords) {
    const targetIndex = statements.findIndex((statement) => statement.line === call.targetLine)
    if (targetIndex < 0) continue
    let rangeEnd = statements.length
    for (let index = targetIndex + 1; index < statements.length; index++) {
      if (
        statements[index]!.tokens[0]?.kind === 'label' &&
        callTargetLines.has(statements[index]!.line)
      ) {
        rangeEnd = index
        break
      }
    }
    for (let index = targetIndex; index < rangeEnd; index++) {
      if (statements[index]!.cmd !== 'return') continue
      const returnNode = nodeForStatement(index)
      if (!returnNode) continue
      let targets = returnTargets.get(returnNode)
      if (!targets) {
        targets = new Set()
        returnTargets.set(returnNode, targets)
      }
      targets.add(call.successor)
    }
  }
  for (const [returnNode, targets] of returnTargets) {
    removeOutgoing(edges, returnNode)
    for (const target of targets) addEdge(edges, returnNode, target, 'return', '復帰')
  }

  const maxDepth = options.maxIncludeDepth ?? 8
  const sourceLines = stripComments(source)
  const forBlocks = createForLoopBlockList(source)
  const staticArrays = collectStaticStringArrayValues(sourceLines)
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]!
    if (statement.cmd !== 'include' || !resolver) continue
    const includeNode = nodeForStatement(index)
    if (!includeNode) continue
    const arg = statement.tokens[statement.offset + 1]
    const rawArg = extractIncludeArgText(statement.tokens, statement.offset)
    const isLiteral = arg?.kind === 'string'
    const resolutions: Array<{
      linkedId: string | null | undefined
      content: string | null
      edgeLabel: string
      instanceSuffix: string
    }> = []
    const loopContext = !isLiteral ? getLoopContextForLine(forBlocks, statement.line) : undefined
    const loopBlock = !isLiteral ? getForLoopBlockForLine(forBlocks, statement.line) : undefined
    if (loopContext && loopBlock) {
      for (const value of loopContext.values) {
        let effectiveRaw = computeLoopIncludeEffectiveRaw(
          sourceLines,
          statement.line,
          loopBlock,
          rawArg,
          value,
          staticArrays,
        )
        const directArray = statement.tokens[statement.offset + 1]
        const directOpen = statement.tokens[statement.offset + 2]
        const directIndex = statement.tokens[statement.offset + 3]
        const directClose = statement.tokens[statement.offset + 4]
        if (
          effectiveRaw === undefined &&
          directArray?.kind === 'identifier' &&
          directOpen?.text === '[' &&
          directIndex?.kind === 'identifier' &&
          directIndex.text.toLowerCase() === loopContext.variable.toLowerCase() &&
          directClose?.text === ']'
        ) {
          effectiveRaw = staticArrays.get(directArray.text.toLowerCase())?.get(value)
        }
        const bindingKey = resolveLoopIncludeBindingKey(statement.line, value, effectiveRaw)
        resolutions.push({
          linkedId: resolver.getLinkedTabId(bindingKey, rawArg, effectiveRaw),
          content: resolver.resolveDynamic(rawArg, {
            line: statement.line,
            loopValue: value,
            rawArg,
            effectiveRaw,
          }),
          edgeLabel: `${loopContext.variable}=${value}`,
          instanceSuffix: `${loopContext.variable}-${value}`,
        })
      }
    } else {
      const bindingKey = isLiteral
        ? normalizeIncludePath(unquoteString(arg.text))
        : includeDynamicBindingKey(rawArg)
      resolutions.push({
        linkedId: resolver.getLinkedTabId(bindingKey, isLiteral ? undefined : rawArg),
        content: isLiteral
          ? resolver.resolve(unquoteString(arg.text))
          : resolver.resolveDynamic(rawArg, { line: statement.line, rawArg }),
        edgeLabel: 'include',
        instanceSuffix: 'single',
      })
    }
    const resolved = resolutions.filter(
      (item): item is typeof item & { linkedId: string; content: string } =>
        item.linkedId != null && item.content != null,
    )
    if (resolved.length === 0) {
      warnings.push(`${sourceName}:L${statement.line} include先がリンクされていません`)
      continue
    }
    removeOutgoing(edges, includeNode)
    for (const item of resolved) {
      if (includeStack.includes(item.linkedId) || includeStack.length >= maxDepth) {
        const warningId = `${safeIdPart(instanceId)}-include-warning-${statement.line}-${safeIdPart(item.instanceSuffix)}`
        nodes.push({
          id: warningId,
          sourceId,
          sourceName,
          line: statement.line,
          endLine: statement.line,
          location: `${sourceId}:L${statement.line}`,
          kind: 'warning',
          label: includeStack.includes(item.linkedId) ? '循環include' : 'include展開上限',
        })
        addEdge(edges, includeNode, warningId, 'include', item.edgeLabel)
        addEdge(edges, warningId, nodeAfterStatement(index), 'flow')
        warnings.push(`${sourceName}:L${statement.line} includeを再帰展開できません`)
        continue
      }
      const childResolver = resolver.resolverForLinkedTab(item.linkedId) ?? undefined
      const childName = options.getSourceName?.(item.linkedId) ?? item.linkedId
      const childInstanceId = `${instanceId}__include-L${statement.line}-${item.instanceSuffix}__${item.linkedId}`
      const child = buildFileGraph(
        item.content,
        item.linkedId,
        childName,
        childInstanceId,
        childResolver,
        options,
        [...includeStack, item.linkedId],
        effectiveGlobalExitId,
      )
      nodes.push(...child.nodes)
      edges.push(...child.edges)
      warnings.push(...child.warnings)
      addEdge(edges, includeNode, child.entryId, 'include', item.edgeLabel)
      addEdge(edges, child.exitId, nodeAfterStatement(index), 'return', '復帰')
    }
  }

  return { entryId, exitId, nodes, edges, warnings }
}

export function buildFlowchart(source: string, options: BuildFlowchartOptions): FlowchartModel {
  const graph = buildFileGraph(
    source,
    options.sourceId,
    options.sourceName,
    options.sourceId,
    options.includeResolver,
    options,
    [options.sourceId],
  )
  return compactForDisplay(
    {
      rootSourceId: options.sourceId,
      nodes: graph.nodes,
      edges: graph.edges,
      warnings: graph.warnings,
    },
    options.showAssignments ?? false,
  )
}
