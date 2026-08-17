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
  type AnalysisLimitations,
} from '../ttl/analysisLimitations'
import {
  findIncludeRefs,
  includeDynamicBindingKey,
  isIncludeRefLinked,
  migrateIncludeBindings,
  normalizeIncludePath,
  resolveIncludeBindingTabId,
  resolveLoopIncludeBindingKey,
  type IncludeResolveContext,
} from '../ttl/includeRefs'
import { evaluateTTL } from '../ttl/evaluator'
import { buildFlowchart } from '../ttl/flowchart'
import {
  setIncludeResolver,
  setIncludeCrossTabContext,
  setAnalysisCache,
} from '../ttl/analysisContext'
import type { EditorTab } from '../ui/tabManager'

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

export function collectWorkspaceAnalysisLimitations(
  host: IncludeWorkspaceHost,
  originTab: EditorTab,
  originSource: string,
  originBranches?: ReturnType<typeof collectIndeterminateIfBranches>,
  originVariables?: ReturnType<typeof collectIndeterminateVariables>,
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
        })
    const evalForLimitations = () =>
      evalForCollect
      ?? evaluateTTL(current.source, {
        includeResolver: createIncludeResolver(host, current.tab),
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
    analysisLimitations: AnalysisLimitations
  }): void
  updateFlowchart(model: ReturnType<typeof buildFlowchart> | null): void
  refreshIncludePanel(text: string, options?: { readOnly?: boolean }): void
  isDryRunInProgress(): boolean
  schedulePersistWorkspaceSession(): void
  flowchartShowDetailedWaits: () => boolean
  flowchartShowAssignments: () => boolean
}

const ANALYSIS_DEBOUNCE_MS = 250

export function createAnalysisCoordinator(host: AnalysisCoordinatorHost) {
  let analysisTimer: ReturnType<typeof setTimeout> | null = null

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

    const result = analyzeTTL(text, {
      includeResolver: resolver,
      externallyUsedNames: crossTab?.externallyUsed,
      externallyDeclaredVars: crossTab?.externallyDeclared,
    })
    const evaluationForCollect = evaluateTTL(text, {
      includeResolver: resolver,
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
      tab.variableAssumptions = pruneVariableAssumptions(tab.variableAssumptions ?? {}, validVarKeys)
    }

    const variableAssumptions = tab
      ? variableAssumptionsFromRecord(tab.variableAssumptions)
      : new Map<number, Map<string, string>>()

    const evaluationForBranches =
      hasVariableAssumptions(variableAssumptions)
        ? evaluateTTL(text, {
            includeResolver: resolver,
            variableAssumptions,
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
      analysisLimitations,
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
