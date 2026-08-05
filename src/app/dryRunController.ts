import {
  DryRunSession,
  isDryRunMainLocation,
  type DryRunDialogAdapter,
  type DryRunState,
} from '../ttl/dryRun'
import type { IncludeResolver } from '../ttl/analyzer'
import {
  includeDynamicBindingKey,
  normalizeIncludePath,
  resolveIncludeBindingTabId,
  resolveIncludePathBindingKey,
} from '../ttl/includeRefs'
import type { EditorTab } from '../ui/tabManager'
import type { DryRunSnapshot } from './analysisCoordinator'
import type { AnalysisLimitations } from '../ttl/analysisLimitations'
import {
  formatAnalysisLimitationWarning,
  hasAnalysisLimitations,
} from '../ttl/analysisLimitations'
import {
  sourcesUseCommandLineParams,
  type MacroArgvInput,
} from '../ttl/commandLineParams'
import { showDryRunMacroArgvDialog } from '../ui/dryRunMacroArgvDialog'

export interface DryRunControllerHost {
  allTabs: () => readonly EditorTab[]
  getActiveTab(): EditorTab | null
  getEditorValue(): string
  switchTab(tabId: string, options?: { keepDryRun?: boolean }): void
  gotoLine(line: number): void
  setExecutionLine(line: number, waiting: boolean): void
  clearExecutionLine(): void
  setDryRunLocked(locked: boolean): void
  setDryRunToolbarState(active: boolean): void
  showDryRunTab(): void
  updateDryRun(state: DryRunState): void
  setStatusMessage(message: string): void
  cancelActiveDialog(): void
  syncTabIncludeBindings(tab: EditorTab, source: string): void
  collectAnalysisLimitations(tab: EditorTab, source: string): AnalysisLimitations
  snapshotDryRunContext(originTab: EditorTab): DryRunSnapshot
  createIncludeResolver(tab: EditorTab, snapshot?: DryRunSnapshot): IncludeResolver
  runAnalysisNow(text: string): void
  updateCursorPosition(): void
  dialogAdapter: DryRunDialogAdapter
}

export function createDryRunController(host: DryRunControllerHost) {
  let dryRunSession: DryRunSession | null = null
  let dryRunRunPromise: Promise<DryRunState> | null = null
  let dryRunActive = false
  /** 引数ダイアログ表示中など、セッション開始前の再入防止 */
  let dryRunStarting = false
  let dryRunRunId = 0
  let dryRunOriginTabId: string | null = null
  let dryRunSnapshot: DryRunSnapshot | null = null

  function isDryRunInProgress(): boolean {
    return dryRunActive || dryRunRunPromise !== null || dryRunStarting
  }

  function dryRunKeepOptions(): { keepDryRun: true } | undefined {
    return isDryRunInProgress() ? { keepDryRun: true } : undefined
  }

  function getDryRunOriginTab(): EditorTab | null {
    if (!dryRunOriginTabId) return null
    return host.allTabs().find((t) => t.id === dryRunOriginTabId) ?? null
  }

  function getBindingsForTab(tab: EditorTab): Record<string, string> {
    if (isDryRunInProgress() && dryRunSnapshot) {
      return dryRunSnapshot.bindings.get(tab.id) ?? tab.includeBindings
    }
    return tab.includeBindings
  }

  /** ドライラン起点から include バインディングを辿って到達できるタブ ID */
  function collectDryRunLinkedTabIds(originTab: EditorTab): Set<string> {
    const linked = new Set<string>()
    const queue: EditorTab[] = [originTab]
    while (queue.length > 0) {
      const tab = queue.pop()!
      const bindings = getBindingsForTab(tab)
      for (const tabId of Object.values(bindings)) {
        if (linked.has(tabId)) continue
        linked.add(tabId)
        const next = host.allTabs().find((t) => t.id === tabId)
        if (next) queue.push(next)
      }
    }
    return linked
  }

  function isDryRunRelatedTab(closedTabId: string): boolean {
    if (closedTabId === dryRunOriginTabId) return true
    const origin = getDryRunOriginTab()
    if (!origin) return false
    return collectDryRunLinkedTabIds(origin).has(closedTabId)
  }

  function findTabForLocationPrefixInTab(prefix: string, tab: EditorTab): EditorTab | null {
    const bindings = getBindingsForTab(tab)
    const directBinding = bindings[prefix]
    if (directBinding) {
      return host.allTabs().find((t) => t.id === directBinding) ?? null
    }
    const fromBindingKey = resolveIncludeBindingTabId(bindings, prefix)
    if (fromBindingKey) {
      return host.allTabs().find((t) => t.id === fromBindingKey) ?? null
    }

    const normalized = normalizeIncludePath(prefix)

    const fromStatic = resolveIncludeBindingTabId(bindings, normalized, undefined, normalized)
    if (fromStatic) {
      return host.allTabs().find((t) => t.id === fromStatic) ?? null
    }

    const loopSuffix = /^(.+)@([a-zA-Z_]\w*)=(-?\d+)$/.exec(prefix)
    if (loopSuffix) {
      const [, rawPart, , valueStr] = loopSuffix
      const loopValue = Number(valueStr)
      const dynamicKey = includeDynamicBindingKey(rawPart!)
      const fromDynamic = resolveIncludeBindingTabId(bindings, dynamicKey, rawPart, rawPart)
      if (fromDynamic) {
        return host.allTabs().find((t) => t.id === fromDynamic) ?? null
      }
      const pathKey = resolveIncludePathBindingKey(rawPart!)
      if (pathKey) {
        const fromPath = resolveIncludeBindingTabId(bindings, pathKey, rawPart, rawPart)
        if (fromPath) {
          return host.allTabs().find((t) => t.id === fromPath) ?? null
        }
      }
      for (const [key, tabId] of Object.entries(bindings)) {
        if (key.startsWith('@loop:L') && key.endsWith(`:${loopValue}`)) {
          return host.allTabs().find((t) => t.id === tabId) ?? null
        }
      }
    } else {
      const dynamicKey = includeDynamicBindingKey(prefix)
      const fromDynamic = resolveIncludeBindingTabId(bindings, dynamicKey, prefix, prefix)
      if (fromDynamic) {
        return host.allTabs().find((t) => t.id === fromDynamic) ?? null
      }
      const pathKey = resolveIncludePathBindingKey(prefix)
      if (pathKey) {
        const fromPath = resolveIncludeBindingTabId(bindings, pathKey, prefix, prefix)
        if (fromPath) {
          return host.allTabs().find((t) => t.id === fromPath) ?? null
        }
      }
    }

    return null
  }

  function findTabForLocationPrefix(prefix: string, contextTab: EditorTab | null): EditorTab | null {
    const directTab = host.allTabs().find((tab) => tab.id === prefix)
    if (directTab) return directTab
    if (!contextTab) return null

    const normalized = normalizeIncludePath(prefix)
    const fromContext = findTabForLocationPrefixInTab(prefix, contextTab)
    if (fromContext) return fromContext

    for (const tabId of collectDryRunLinkedTabIds(contextTab)) {
      const linkedTab = host.allTabs().find((t) => t.id === tabId)
      if (!linkedTab) continue
      const fromLinked = findTabForLocationPrefixInTab(prefix, linkedTab)
      if (fromLinked) return fromLinked
    }

    const matches = host.allTabs().filter(
      (tab) => tab.fileName === prefix || tab.fileName === normalized,
    )
    return matches.length === 1 ? matches[0]! : null
  }

  function dryRunLocationMatchesActiveTab(location: string | undefined): boolean {
    if (!location) return false
    const tab = host.getActiveTab()
    if (!tab) return false
    if (isDryRunMainLocation(location)) {
      return tab.id === dryRunOriginTabId
    }
    const prefixed = /^(.*):L\d+$/.exec(location)
    if (!prefixed) return false
    const contextTab = getDryRunOriginTab() ?? tab
    const targetTab = findTabForLocationPrefix(prefixed[1]!, contextTab)
    return targetTab?.id === tab.id
  }

  function refreshDryRunHighlight(): void {
    const session = dryRunSession
    if (session) applyDryRunExecutionHighlight(session.getState())
  }

  function applyDryRunExecutionHighlight(state: DryRunState): void {
    if (state.status === 'waiting-dialog' || state.status === 'running') {
      if (dryRunLocationMatchesActiveTab(state.currentLocation)) {
        host.setExecutionLine(state.currentLine, state.status === 'waiting-dialog')
      } else {
        host.clearExecutionLine()
      }
      return
    }
    if (state.status === 'finished' || state.status === 'stopped' || state.status === 'error') {
      host.clearExecutionLine()
    }
  }

  function gotoTtlLocation(location: string, contextTab: EditorTab | null): boolean {
    const keepDryRun = dryRunKeepOptions()
    const mainMatch = /^L(\d+)$/.exec(location)
    if (mainMatch) {
      if (contextTab && host.getActiveTab()?.id !== contextTab.id) {
        host.switchTab(contextTab.id, keepDryRun)
      }
      host.gotoLine(Number(mainMatch[1]))
      refreshDryRunHighlight()
      return true
    }
    const prefixed = /^(.*):L(\d+)$/.exec(location)
    if (!prefixed) return false
    const [, prefix, lineStr] = prefixed
    const targetTab = findTabForLocationPrefix(prefix!, contextTab)
    if (targetTab) {
      host.switchTab(targetTab.id, keepDryRun)
      host.gotoLine(Number(lineStr))
      refreshDryRunHighlight()
      return true
    }
    return false
  }

  function gotoSendLocation(location: string): void {
    if (!gotoTtlLocation(location, host.getActiveTab())) {
      host.setStatusMessage('送信データの参照先タブを特定できません')
    }
  }

  function gotoDryRunLocation(location: string): void {
    gotoTtlLocation(location, getDryRunOriginTab() ?? host.getActiveTab())
  }

  function gotoFlowchartLocation(location: string): void {
    if (!gotoTtlLocation(location, host.getActiveTab())) {
      host.setStatusMessage('フローチャートの参照先タブを特定できません')
    }
  }

  function stopDryRun(): void {
    dryRunStarting = false
    dryRunActive = false
    dryRunRunPromise = null
    dryRunSnapshot = null
    const session = dryRunSession
    if (session) {
      session.stop()
      host.updateDryRun(session.getState())
      host.cancelActiveDialog()
      dryRunSession = null
    } else {
      host.cancelActiveDialog()
    }
    dryRunRunId++
    host.setDryRunToolbarState(false)
    host.clearExecutionLine()
    host.setDryRunLocked(false)
    host.runAnalysisNow(host.getEditorValue())
    host.updateCursorPosition()
  }

  async function startDryRun(): Promise<void> {
    if (dryRunActive || dryRunRunPromise || dryRunStarting) return
    dryRunStarting = true
    host.setDryRunToolbarState(true)
    try {
      const tab = host.getActiveTab()
      const currentSource = host.getEditorValue()
      if (tab) {
        host.syncTabIncludeBindings(tab, currentSource)
        const limitations = host.collectAnalysisLimitations(tab, currentSource)
        const dryRunLimitations: AnalysisLimitations = {
          unassumedBranches: [],
          unlinkedIncludes: limitations.unlinkedIncludes,
        }
        if (
          hasAnalysisLimitations(dryRunLimitations) &&
          !confirm(
            `${formatAnalysisLimitationWarning(dryRunLimitations)}\n\n` +
              'タブ未指定の include はドライランで実行できません。\n' +
              'このままドライランを開始しますか？',
          )
        ) {
          return
        }
      }

      // 検出専用（ダイアログ表示判定）。実行用スナップショットはダイアログ後に取り直す
      const detectionSource = host.getEditorValue()
      const detectionSnapshot = tab ? host.snapshotDryRunContext(tab) : null
      if (tab && detectionSnapshot) {
        detectionSnapshot.contents.set(tab.id, detectionSource)
      }
      const detectionSources: string[] = detectionSnapshot
        ? [...detectionSnapshot.contents.values()]
        : [detectionSource]

      let macroArgv: MacroArgvInput | undefined
      if (sourcesUseCommandLineParams(detectionSources)) {
        const argvChoice = await showDryRunMacroArgvDialog()
        if (argvChoice.action === 'cancel') return
        macroArgv = argvChoice.macroArgv
      }

      // ダイアログ表示中の編集を反映してから実行用スナップショットを固定
      const originTab = tab
      const stillOnOrigin = !!(originTab && host.getActiveTab()?.id === originTab.id)
      const launchSource = stillOnOrigin ? host.getEditorValue() : undefined
      if (originTab) {
        if (stillOnOrigin && launchSource !== undefined) {
          host.syncTabIncludeBindings(originTab, launchSource)
        }
        dryRunSnapshot = host.snapshotDryRunContext(originTab)
        if (stillOnOrigin && launchSource !== undefined) {
          dryRunSnapshot.contents.set(originTab.id, launchSource)
        }
      } else {
        dryRunSnapshot = null
      }

      dryRunActive = true
      const runId = ++dryRunRunId
      try {
        const sourceSnapshot =
          originTab && dryRunSnapshot
            ? dryRunSnapshot.contents.get(originTab.id) ?? host.getEditorValue()
            : host.getEditorValue()
        const resolver =
          originTab && dryRunSnapshot
            ? host.createIncludeResolver(originTab, dryRunSnapshot)
            : originTab
              ? host.createIncludeResolver(originTab)
              : undefined

        dryRunOriginTabId = originTab?.id ?? null
        host.setDryRunLocked(true)
        host.showDryRunTab()
        host.updateDryRun({ status: 'running', currentLine: 1, events: [] })

        const session = new DryRunSession({
          source: sourceSnapshot,
          includeResolver: resolver,
          macroArgv,
          dialogAdapter: host.dialogAdapter,
          onStateChange(state) {
            if (runId !== dryRunRunId) return
            host.updateDryRun(state)
            applyDryRunExecutionHighlight(state)
            if (state.status === 'finished' || state.status === 'stopped' || state.status === 'error') {
              host.setDryRunToolbarState(false)
            }
          },
          async yieldEveryLine() {
            await new Promise((r) => setTimeout(r, 0))
          },
        })

        dryRunSession = session
        dryRunRunPromise = session.run()
        // セッション開始後は starting を解除（以降は dryRunActive / runPromise でガード）
        dryRunStarting = false
        try {
          await dryRunRunPromise
        } finally {
          if (runId === dryRunRunId) {
            dryRunRunPromise = null
            dryRunSession = null
            dryRunActive = false
            dryRunSnapshot = null
            host.setDryRunToolbarState(false)
            host.clearExecutionLine()
            host.setDryRunLocked(false)
            host.runAnalysisNow(host.getEditorValue())
            host.updateCursorPosition()
          }
        }
      } catch (err) {
        // Session 生成前の例外で dryRunActive が残らないようにする
        if (runId === dryRunRunId) {
          dryRunRunPromise = null
          dryRunSession = null
          dryRunActive = false
          dryRunSnapshot = null
          host.setDryRunToolbarState(false)
          host.clearExecutionLine()
          host.setDryRunLocked(false)
        }
        throw err
      }
    } finally {
      if (dryRunStarting) {
        // ダイアログキャンセル等でセッション未開始のときツールバーを戻す
        host.setDryRunToolbarState(false)
      }
      dryRunStarting = false
    }
  }

  function clearDryRunPanel(): void {
    if (isDryRunInProgress()) stopDryRun()
    dryRunOriginTabId = null
    host.updateDryRun({ status: 'idle', currentLine: 0, events: [] })
  }

  function onTabClosed(closedTabId: string): void {
    const related = isDryRunRelatedTab(closedTabId)
    if (closedTabId === dryRunOriginTabId) dryRunOriginTabId = null
    if (isDryRunInProgress() && related) stopDryRun()
  }

  return {
    isDryRunInProgress,
    dryRunKeepOptions,
    getDryRunOriginTab,
    stopDryRun,
    startDryRun,
    clearDryRunPanel,
    onTabClosed,
    gotoSendLocation,
    gotoDryRunLocation,
    gotoFlowchartLocation,
    refreshDryRunHighlight,
    /** タブ切替時など、進行中なら stop */
    stopIfRunning(): void {
      if (isDryRunInProgress()) stopDryRun()
    },
  }
}

export type DryRunController = ReturnType<typeof createDryRunController>
