import type { IncludeResolver, VariableInfo } from '../ttl/analyzer'
import { analyzeTTL, collectIncludeCrossTabVarContext } from '../ttl/analyzer'
import {
  collectIndeterminateIfBranches,
  branchAssumptionsFromRecord,
  pruneBranchAssumptions,
} from '../ttl/branchAssumptions'
import {
  collectIndeterminateVariables,
  variableAssumptionsFromRecord,
  pruneVariableAssumptions,
  variableAssumptionKey,
  hasVariableAssumptions,
} from '../ttl/variableAssumptions'
import {
  collectActiveFlushrecvWarningLines,
  flushrecvWarningIgnoresFromRecord,
  pruneFlushrecvWarningIgnores,
} from '../ttl/flushrecvWarningIgnores'
import {
  collectActiveConsecutiveSendWarningLines,
  consecutiveSendWarningIgnoresFromRecord,
  pruneConsecutiveSendWarningIgnores,
} from '../ttl/consecutiveSendWarningIgnores'
import {
  type AnalysisLimitations,
} from '../ttl/analysisLimitations'
import {
  findIncludeRefs,
  includeDynamicBindingKey,
  includeLoopIterationBindingKey,
  isIncludeRefLinked,
  isLoopIncludeCommonTab,
  loopIncludeIterationValuesForTab,
  migrateIncludeBindings,
  normalizeIncludePath,
  resolveIncludeBindingTabId,
  resolveLoopIncludeBindingKey,
  type IncludeRef,
  type IncludeResolveContext,
} from '../ttl/includeRefs'
import { evaluateTTL, type EvaluationResult, type MacroEnvironment } from '../ttl/evaluator'
import { buildFlowchart } from '../ttl/flowchart'
import {
  setIncludeResolver,
  setIncludeCrossTabContext,
  setFlushrecvBeforeSendCheck,
  setConsecutiveSendCheck,
  getEditorAnalyzeOptions,
  setAnalysisCache,
} from '../ttl/analysisContext'
import type { EditorTab } from '../ui/tabManager'
import { importedEnvParentKey } from '../storage/importedEnvParentKey'

export { importedEnvParentKey }

export interface DryRunSnapshot {
  contents: Map<string, string>
  bindings: Map<string, Record<string, string>>
}

export interface IncludeWorkspaceHost {
  allTabs: readonly EditorTab[]
  getTabContent(tab: EditorTab): string
}

/** ドライラン起点からリンク先タブの内容・バインディングを起動時点で固定する */
export function snapshotDryRunContext(
  host: IncludeWorkspaceHost,
  originTab: EditorTab,
): DryRunSnapshot {
  const contents = new Map<string, string>()
  const bindings = new Map<string, Record<string, string>>()
  const visit = (tab: EditorTab) => {
    if (!contents.has(tab.id)) {
      contents.set(tab.id, host.getTabContent(tab))
      bindings.set(tab.id, { ...tab.includeBindings })
    }
    for (const tabId of Object.values(bindings.get(tab.id)!)) {
      const linked = host.allTabs.find((t) => t.id === tabId)
      if (linked) visit(linked)
    }
  }
  visit(originTab)
  return { contents, bindings }
}

export function createIncludeResolver(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
  dryRunSnapshot?: DryRunSnapshot,
): IncludeResolver {
  const readContent = (tabId: string): string | null => {
    if (dryRunSnapshot) return dryRunSnapshot.contents.get(tabId) ?? null
    const linkedTab = host.allTabs.find((t) => t.id === tabId)
    if (!linkedTab) return null
    return host.getTabContent(linkedTab)
  }

  const tabBindings = () => dryRunSnapshot?.bindings.get(tab.id) ?? tab.includeBindings

  const resolveTabId = (bindingKey: string, rawArg?: string, effectiveRaw?: string) =>
    resolveIncludeBindingTabId(tabBindings(), bindingKey, rawArg, effectiveRaw)

  const resolveByKey = (bindingKey: string, rawArg?: string, effectiveRaw?: string) => {
    const tabId = resolveTabId(bindingKey, rawArg, effectiveRaw)
    return tabId ? readContent(tabId) : null
  }

  return {
    resolve(path: string) {
      return resolveByKey(normalizeIncludePath(path))
    },
    resolveDynamic(rawArg: string, context?: IncludeResolveContext) {
      const bindingKey =
        context?.loopValue !== undefined && context.line !== undefined
          ? resolveLoopIncludeBindingKey(context.line, context.loopValue, context.effectiveRaw)
          : includeDynamicBindingKey(rawArg)
      return resolveByKey(bindingKey, rawArg, context?.effectiveRaw)
    },
    getLinkedTabId(bindingKey: string, rawArg?: string, effectiveRaw?: string) {
      return resolveTabId(bindingKey, rawArg, effectiveRaw)
    },
    resolverForLinkedTab(tabId: string) {
      if (tabId === tab.id) return null
      const linkedTab = host.allTabs.find((t) => t.id === tabId)
      return linkedTab ? createIncludeResolver(host, linkedTab, dryRunSnapshot) : null
    },
    getBranchAssumptions(tabId: string) {
      // 分岐仮定は静的表示専用。ドライラン用スナップショットには混入させない。
      if (dryRunSnapshot) return undefined
      const linkedTab = host.allTabs.find((t) => t.id === tabId)
      return linkedTab
        ? branchAssumptionsFromRecord(linkedTab.branchAssumptions)
        : undefined
    },
    getVariableAssumptions(tabId: string) {
      // 変数仮定も静的表示専用。ドライラン用スナップショットには混入させない。
      if (dryRunSnapshot) return undefined
      const linkedTab = host.allTabs.find((t) => t.id === tabId)
      return linkedTab
        ? variableAssumptionsFromRecord(linkedTab.variableAssumptions)
        : undefined
    },
  }
}

/** この ref が指定タブへ紐づいているか（ループは反復ごとの別タブも見る） */
function includeRefLinksTab(
  ref: IncludeRef,
  bindings: Record<string, string>,
  tabId: string,
): boolean {
  if (ref.loopContext) {
    if (isLoopIncludeCommonTab(ref, bindings, tabId)) return true
    return loopIncludeIterationValuesForTab(ref, bindings, tabId).length > 0
  }
  if (ref.path) {
    return resolveIncludeBindingTabId(bindings, normalizeIncludePath(ref.path), ref.raw) === tabId
  }
  if (ref.isDynamic && ref.raw) {
    return resolveIncludeBindingTabId(bindings, includeDynamicBindingKey(ref.raw), ref.raw) === tabId
  }
  return false
}

/** 親評価から、このタブへ紐づく include 直前 env を取る（ループは反復キー優先） */
function importedEnvFromParentEval(
  parentEval: EvaluationResult,
  ref: IncludeRef,
  bindings: Record<string, string>,
  tabId: string,
): MacroEnvironment | undefined {
  if (!ref.loopContext) return parentEval.beforeLine.get(ref.line)

  if (isLoopIncludeCommonTab(ref, bindings, tabId)) {
    return parentEval.beforeLine.get(ref.line)
  }

  const matchedValues = loopIncludeIterationValuesForTab(ref, bindings, tabId)
  const matchedValue = matchedValues[matchedValues.length - 1]
  if (matchedValue !== undefined) {
    return (
      parentEval.beforeIncludeByLoopKey.get(includeLoopIterationBindingKey(ref.line, matchedValue))
      ?? parentEval.beforeLine.get(ref.line)
    )
  }
  return parentEval.beforeLine.get(ref.line)
}

export interface ImportedEnvParentCandidate {
  key: string
  parentTabId: string
  parentFileName: string
  includeLine: number
}

interface ImportedEnvParentMatch {
  parentTab: EditorTab
  ref: IncludeRef
}

function collectImportedEnvParentMatches(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
): ImportedEnvParentMatch[] {
  const matches: ImportedEnvParentMatch[] = []
  for (const parentTab of host.allTabs) {
    if (parentTab.id === tab.id) continue
    const bindings = parentTab.includeBindings ?? {}
    if (!Object.values(bindings).includes(tab.id)) continue
    const parentSource = host.getTabContent(parentTab)
    for (const ref of findIncludeRefs(parentSource)) {
      if (includeRefLinksTab(ref, bindings, tab.id)) matches.push({ parentTab, ref })
    }
  }
  return matches
}

function importedEnvForParentMatch(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
  match: ImportedEnvParentMatch,
  state: ImportedEnvResolveState,
  visiting: Set<string>,
): MacroEnvironment | undefined {
  const parentEval = parentEvalForImportedEnv(host, match.parentTab, state, visiting)
  return importedEnvFromParentEval(
    parentEval,
    match.ref,
    match.parentTab.includeBindings ?? {},
    tab.id,
  )
}

/** 親評価でその include 行の直前 env があるものだけ（if 0 / goto 飛ばしは除く） */
function collectReachableImportedEnvParentMatches(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
  state: ImportedEnvResolveState,
  visiting: Set<string>,
): ImportedEnvParentMatch[] {
  return collectImportedEnvParentMatches(host, tab).filter(
    (match) => importedEnvForParentMatch(host, tab, match, state, visiting) !== undefined,
  )
}

export function collectImportedEnvParentCandidates(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
): ImportedEnvParentCandidate[] {
  return collectImportedEnvParentCandidateList(host, tab, createImportedEnvResolveState())
}

function collectImportedEnvParentCandidateList(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
  state: ImportedEnvResolveState,
): ImportedEnvParentCandidate[] {
  return collectReachableImportedEnvParentMatches(host, tab, state, new Set([tab.id])).map((match) => ({
    key: importedEnvParentKey(match.parentTab.id, match.ref.line),
    parentTabId: match.parentTab.id,
    parentFileName: match.parentTab.fileName,
    includeLine: match.ref.line,
  }))
}

/** 同名タブは登場順の番号で区別する。同一親の複数 include は行番号で足りる */
export function formatImportedEnvParentOptionLabel(
  candidate: ImportedEnvParentCandidate,
  candidates: readonly ImportedEnvParentCandidate[],
): string {
  const parentIdsWithSameName: string[] = []
  for (const item of candidates) {
    if (item.parentFileName !== candidate.parentFileName) continue
    if (!parentIdsWithSameName.includes(item.parentTabId)) parentIdsWithSameName.push(item.parentTabId)
  }
  const name =
    parentIdsWithSameName.length > 1
      ? `${candidate.parentFileName} #${parentIdsWithSameName.indexOf(candidate.parentTabId) + 1}`
      : candidate.parentFileName
  return `${name}（L${candidate.includeLine}）`
}

function pickImportedEnvParentMatch(
  matches: readonly ImportedEnvParentMatch[],
  selectedKey: string | undefined,
): ImportedEnvParentMatch | undefined {
  if (matches.length === 0) return undefined
  if (selectedKey) {
    const selected = matches.find(
      (match) => importedEnvParentKey(match.parentTab.id, match.ref.line) === selectedKey,
    )
    if (selected) return selected
  }
  return matches[0]
}

/** 紐づかなくなった親選択を消す。変更したら true */
export function pruneImportedEnvParentKey(
  tab: EditorTab,
  candidates: readonly ImportedEnvParentCandidate[],
): boolean {
  const key = tab.importedEnvParentKey
  if (!key) return false
  if (candidates.some((candidate) => candidate.key === key)) return false
  delete tab.importedEnvParentKey
  return true
}

interface ImportedEnvResolveState {
  importedEnvByTab: Map<string, MacroEnvironment | undefined>
  parentEvalByTab: Map<string, EvaluationResult>
}

function createImportedEnvResolveState(): ImportedEnvResolveState {
  return {
    importedEnvByTab: new Map(),
    parentEvalByTab: new Map(),
  }
}

function parentEvalForImportedEnv(
  host: IncludeWorkspaceHost,
  parentTab: EditorTab,
  state: ImportedEnvResolveState,
  visiting: Set<string>,
): EvaluationResult {
  const cached = state.parentEvalByTab.get(parentTab.id)
  if (cached) return cached
  const parentEval = evaluateTTL(host.getTabContent(parentTab), {
    includeResolver: createIncludeResolver(host, parentTab),
    variableAssumptions: variableAssumptionsFromRecord(parentTab.variableAssumptions),
    branchAssumptions: branchAssumptionsFromRecord(parentTab.branchAssumptions),
    importedEnv: resolveImportedEnvFromParentIncludes(host, parentTab, state, visiting),
  })
  state.parentEvalByTab.set(parentTab.id, parentEval)
  return parentEval
}

function resolveImportedEnvFromParentIncludes(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
  state: ImportedEnvResolveState,
  visiting: Set<string> = new Set(),
): MacroEnvironment | undefined {
  if (state.importedEnvByTab.has(tab.id)) return state.importedEnvByTab.get(tab.id)
  if (visiting.has(tab.id)) {
    state.importedEnvByTab.set(tab.id, undefined)
    return undefined
  }
  visiting.add(tab.id)

  const match = pickImportedEnvParentMatch(
    collectReachableImportedEnvParentMatches(host, tab, state, visiting),
    tab.importedEnvParentKey,
  )
  if (!match) {
    state.importedEnvByTab.set(tab.id, undefined)
    return undefined
  }

  const env = importedEnvForParentMatch(host, tab, match, state, visiting)
  state.importedEnvByTab.set(tab.id, env)
  return env
}

/** include 先タブ評価用。親の include 直前 env（入れ子 include は親側も遡る） */
export function importedEnvFromParentIncludes(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
): MacroEnvironment | undefined {
  return resolveImportedEnvFromParentIncludes(host, tab, createImportedEnvResolveState())
}

export function collectWorkspaceAnalysisLimitations(
  host: IncludeWorkspaceHost,
  originTab: EditorTab,
  originSource: string,
  originBranches?: ReturnType<typeof collectIndeterminateIfBranches>,
  originVariables?: ReturnType<typeof collectIndeterminateVariables>,
  importedEnvState: ImportedEnvResolveState = createImportedEnvResolveState(),
): AnalysisLimitations {
  const limitations: AnalysisLimitations = {
    unassumedBranches: [],
    unassumedVariables: [],
    unlinkedIncludes: [],
  }
  const visited = new Set<string>()
  const queue: Array<{ tab: EditorTab; source: string }> = [
    { tab: originTab, source: originSource },
  ]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current.tab.id)) continue
    visited.add(current.tab.id)

    const refs = findIncludeRefs(current.source)
    for (const ref of refs) {
      if (!isIncludeRefLinked(ref, current.tab.includeBindings)) {
        limitations.unlinkedIncludes.push({
          sourceName: current.tab.fileName,
          line: ref.line,
          raw: ref.raw,
        })
      }
    }

    const isOriginTab = current.tab.id === originTab.id
    const skipEval = isOriginTab && originBranches !== undefined && originVariables !== undefined
    const evalForCollect = skipEval
      ? null
      : evaluateTTL(current.source, {
          includeResolver: createIncludeResolver(host, current.tab),
          importedEnv: resolveImportedEnvFromParentIncludes(host, current.tab, importedEnvState),
        })
    const evalForLimitations = () =>
      evalForCollect
      ?? evaluateTTL(current.source, {
        includeResolver: createIncludeResolver(host, current.tab),
        importedEnv: resolveImportedEnvFromParentIncludes(host, current.tab, importedEnvState),
      })

    const branches =
      isOriginTab && originBranches !== undefined
        ? originBranches
        : collectIndeterminateIfBranches(current.source, evalForLimitations().beforeLine)
    for (const branch of branches) {
      if (current.tab.branchAssumptions?.[String(branch.line)] === undefined) {
        limitations.unassumedBranches.push({
          sourceName: current.tab.fileName,
          line: branch.line,
          conditionText: branch.conditionText,
        })
      }
    }

    const variables =
      isOriginTab && originVariables !== undefined
        ? originVariables
        : (() => {
            const evalResult = evalForLimitations()
            return collectIndeterminateVariables(
              current.source,
              evalResult.beforeLine,
              evalResult.afterLine,
            )
          })()
    for (const variable of variables) {
      const key = variableAssumptionKey(variable.line, variable.name)
      if (current.tab.variableAssumptions?.[key] === undefined) {
        limitations.unassumedVariables.push({
          sourceName: current.tab.fileName,
          line: variable.line,
          name: variable.name,
        })
      }
    }

    for (const linkedTabId of new Set(Object.values(current.tab.includeBindings))) {
      const linkedTab = host.allTabs.find((tab) => tab.id === linkedTabId)
      if (!linkedTab || visited.has(linkedTab.id)) continue
      queue.push({
        tab: linkedTab,
        source: host.getTabContent(linkedTab),
      })
    }
  }

  return limitations
}

/** 未使用・外部宣言の診断は全親を見る。選択した importedEnv 元は送信データとホバー専用 */
export function getIncludeCrossTabContext(
  host: IncludeWorkspaceHost,
  tab: EditorTab,
): {
  externallyDeclared: Map<string, VariableInfo>
  externallyUsed: Set<string>
} {
  const externallyDeclared = new Map<string, VariableInfo>()
  const externallyUsed = new Set<string>()

  for (const parentTab of host.allTabs) {
    if (parentTab.id === tab.id) continue
    const includesThis = Object.values(parentTab.includeBindings).includes(tab.id)
    if (!includesThis) continue

    const ctx = collectIncludeCrossTabVarContext(
      host.getTabContent(parentTab),
      createIncludeResolver(host, parentTab),
      tab.id,
    )
    for (const [key, info] of ctx.externallyDeclared) {
      if (!externallyDeclared.has(key)) externallyDeclared.set(key, info)
    }
    for (const name of ctx.externallyUsed) externallyUsed.add(name)
  }

  return { externallyDeclared, externallyUsed }
}

export interface AnalysisCoordinatorHost {
  includeHost: IncludeWorkspaceHost
  getActiveTab(): EditorTab | null
  getEditorValue(): string
  isEditorValue(text: string): boolean
  notifyIncludeGraphChanged(): void
  setBranchAssumptionDecorations(items: Array<{ line: number; value: boolean }>): void
  setVariableAssumptionDecorations(items: Array<{ line: number; labels: string[] }>): void
  notifyAnalysisCacheChanged(): void
  updateSidePanel(payload: {
    analysis: ReturnType<typeof analyzeTTL>
    sendEntries: ReturnType<typeof evaluateTTL>['sendEntries']
    indeterminateBranches: ReturnType<typeof collectIndeterminateIfBranches>
    branchAssumptions: Record<string, boolean>
    indeterminateVariables: ReturnType<typeof collectIndeterminateVariables>
    variableAssumptions: Record<string, string>
    flushrecvWarningIgnores: Record<string, boolean>
    consecutiveSendWarningIgnores: Record<string, boolean>
    checkFlushrecvBeforeSend: boolean
    checkConsecutiveSend: boolean
    analysisLimitations: AnalysisLimitations
    importedEnvParentCandidates: ImportedEnvParentCandidate[]
    importedEnvParentKey: string
  }): void
  updateFlowchart(model: ReturnType<typeof buildFlowchart> | null): void
  refreshIncludePanel(text: string, options?: { readOnly?: boolean }): void
  isDryRunInProgress(): boolean
  schedulePersistWorkspaceSession(): void
  flowchartShowDetailedWaits: () => boolean
  flowchartShowAssignments: () => boolean
  checkFlushrecvBeforeSend: () => boolean
  checkConsecutiveSend: () => boolean
}

const ANALYSIS_DEBOUNCE_MS = 250

export function createAnalysisCoordinator(host: AnalysisCoordinatorHost) {
  let analysisTimer: ReturnType<typeof setTimeout> | null = null
  setFlushrecvBeforeSendCheck(host.checkFlushrecvBeforeSend())
  setConsecutiveSendCheck(host.checkConsecutiveSend())

  function syncTabIncludeBindings(tab: EditorTab, source: string): void {
    const migrated = migrateIncludeBindings(source, tab.includeBindings)
    if (migrated !== tab.includeBindings) {
      tab.includeBindings = migrated
      host.notifyIncludeGraphChanged()
      host.schedulePersistWorkspaceSession()
    }
  }

  function buildFlowchartForActiveTab(text: string) {
    const tab = host.getActiveTab()
    if (!tab) return null
    const resolver = createIncludeResolver(host.includeHost, tab)
    return buildFlowchart(text, {
      sourceId: tab.id,
      sourceName: tab.fileName,
      includeResolver: resolver,
      getSourceName: (sourceId) =>
        host.includeHost.allTabs.find((candidate) => candidate.id === sourceId)?.fileName,
      showDetailedWaits: host.flowchartShowDetailedWaits(),
      showAssignments: host.flowchartShowAssignments(),
    })
  }

  function runAnalysisImmediate(text: string): void {
    const tab = host.getActiveTab()
    if (tab) syncTabIncludeBindings(tab, text)

    const resolver = tab ? createIncludeResolver(host.includeHost, tab) : undefined
    const crossTab = tab ? getIncludeCrossTabContext(host.includeHost, tab) : undefined
    setIncludeResolver(resolver)
    setIncludeCrossTabContext(crossTab)

    const checkFlushrecv = host.checkFlushrecvBeforeSend()
    const checkConsecutive = host.checkConsecutiveSend()
    if (tab && checkFlushrecv) {
      const activeLines = collectActiveFlushrecvWarningLines(text)
      tab.flushrecvWarningIgnores = pruneFlushrecvWarningIgnores(
        tab.flushrecvWarningIgnores ?? {},
        activeLines,
      )
    }
    if (tab && checkConsecutive) {
      const activeLines = collectActiveConsecutiveSendWarningLines(text)
      tab.consecutiveSendWarningIgnores = pruneConsecutiveSendWarningIgnores(
        tab.consecutiveSendWarningIgnores ?? {},
        activeLines,
      )
    }

    const ignoredFlushrecvLines = tab
      ? flushrecvWarningIgnoresFromRecord(tab.flushrecvWarningIgnores)
      : new Set<number>()
    const ignoredConsecutiveSendLines = tab
      ? consecutiveSendWarningIgnoresFromRecord(tab.consecutiveSendWarningIgnores)
      : new Set<number>()
    setFlushrecvBeforeSendCheck(checkFlushrecv, ignoredFlushrecvLines)
    setConsecutiveSendCheck(checkConsecutive, ignoredConsecutiveSendLines)

    const result = analyzeTTL(text, getEditorAnalyzeOptions())
    const importedEnvState = createImportedEnvResolveState()
    const importedEnvParentCandidates = tab
      ? collectImportedEnvParentCandidateList(host.includeHost, tab, importedEnvState)
      : []
    if (tab && pruneImportedEnvParentKey(tab, importedEnvParentCandidates)) {
      host.schedulePersistWorkspaceSession()
    }
    const importedEnv = tab
      ? resolveImportedEnvFromParentIncludes(host.includeHost, tab, importedEnvState)
      : undefined
    const evaluationForCollect = evaluateTTL(text, {
      includeResolver: resolver,
      importedEnv,
    })
    const indeterminateVariables = collectIndeterminateVariables(
      text,
      evaluationForCollect.beforeLine,
      evaluationForCollect.afterLine,
    )

    if (tab) {
      const validVarKeys = new Set(
        indeterminateVariables.map((v) => variableAssumptionKey(v.line, v.name)),
      )
      const variableValueTypes = new Map(
        indeterminateVariables.map((v) => [
          variableAssumptionKey(v.line, v.name),
          v.valueType,
        ]),
      )
      tab.variableAssumptions = pruneVariableAssumptions(
        tab.variableAssumptions ?? {},
        validVarKeys,
        variableValueTypes,
      )
    }

    const variableAssumptions = tab
      ? variableAssumptionsFromRecord(tab.variableAssumptions)
      : new Map<number, Map<string, string>>()

    const evaluationForBranches =
      hasVariableAssumptions(variableAssumptions)
        ? evaluateTTL(text, {
            includeResolver: resolver,
            variableAssumptions,
            importedEnv,
          })
        : evaluationForCollect
    const indeterminateBranches = collectIndeterminateIfBranches(
      text,
      evaluationForBranches.beforeLine,
    )

    if (tab) {
      const validLines = new Set(indeterminateBranches.map((b) => b.line))
      tab.branchAssumptions = pruneBranchAssumptions(tab.branchAssumptions ?? {}, validLines)
    }

    const branchAssumptions = tab
      ? branchAssumptionsFromRecord(tab.branchAssumptions)
      : new Map<number, boolean>()
    const evaluation =
      branchAssumptions.size > 0
        ? evaluateTTL(text, {
            includeResolver: resolver,
            variableAssumptions,
            branchAssumptions,
            importedEnv,
          })
        : evaluationForBranches

    if (!host.isEditorValue(text)) return

    const analysisLimitations = tab
      ? collectWorkspaceAnalysisLimitations(
          host.includeHost,
          tab,
          text,
          indeterminateBranches,
          indeterminateVariables,
          importedEnvState,
        )
      : { unassumedBranches: [], unassumedVariables: [], unlinkedIncludes: [] }
    host.setBranchAssumptionDecorations(
      [...branchAssumptions].map(([line, value]) => ({ line, value })),
    )
    host.setVariableAssumptionDecorations(
      [...variableAssumptions].map(([line, names]) => ({
        line,
        labels: [...names].map(([name, text]) => `${name}=${text}`),
      })),
    )
    setAnalysisCache(text, result, evaluation)
    host.notifyAnalysisCacheChanged()

    host.updateSidePanel({
      analysis: result,
      sendEntries: evaluation.sendEntries,
      indeterminateBranches,
      branchAssumptions: tab?.branchAssumptions ?? {},
      indeterminateVariables,
      variableAssumptions: tab?.variableAssumptions ?? {},
      flushrecvWarningIgnores: tab?.flushrecvWarningIgnores ?? {},
      consecutiveSendWarningIgnores: tab?.consecutiveSendWarningIgnores ?? {},
      checkFlushrecvBeforeSend: checkFlushrecv,
      checkConsecutiveSend: checkConsecutive,
      analysisLimitations,
      importedEnvParentCandidates,
      importedEnvParentKey: tab?.importedEnvParentKey ?? importedEnvParentCandidates[0]?.key ?? '',
    })
    host.updateFlowchart(buildFlowchartForActiveTab(text))
    host.refreshIncludePanel(text, { readOnly: host.isDryRunInProgress() })
  }

  function runAnalysis(text: string, immediate = false): void {
    if (immediate) {
      if (analysisTimer) {
        clearTimeout(analysisTimer)
        analysisTimer = null
      }
      runAnalysisImmediate(text)
      return
    }
    if (analysisTimer) clearTimeout(analysisTimer)
    analysisTimer = setTimeout(() => {
      analysisTimer = null
      runAnalysisImmediate(text)
    }, ANALYSIS_DEBOUNCE_MS)
  }

  function runAnalysisNow(text: string): void {
    runAnalysis(text, true)
  }

  return {
    syncTabIncludeBindings,
    buildFlowchartForActiveTab,
    runAnalysisImmediate,
    runAnalysis,
    runAnalysisNow,
    collectAnalysisLimitations: (
      originTab: EditorTab,
      originSource: string,
      originBranches?: ReturnType<typeof collectIndeterminateIfBranches>,
    ) =>
      collectWorkspaceAnalysisLimitations(
        host.includeHost,
        originTab,
        originSource,
        originBranches,
      ),
    createIncludeResolver: (tab: EditorTab, dryRunSnapshot?: DryRunSnapshot) =>
      createIncludeResolver(host.includeHost, tab, dryRunSnapshot),
    snapshotDryRunContext: (originTab: EditorTab) =>
      snapshotDryRunContext(host.includeHost, originTab),
  }
}
