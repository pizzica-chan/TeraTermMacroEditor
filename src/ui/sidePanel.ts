import type { AnalysisResult, VariableInfo } from '../ttl/analyzer'
import type { IndeterminateIfBranch } from '../ttl/branchAssumptions'
import type { IndeterminateVariable } from '../ttl/variableAssumptions'
import {
  isValidVariableAssumptionInput,
  variableAssumptionKey,
} from '../ttl/variableAssumptions'
import type { SendEntry } from '../ttl/evaluator'
import { buildDryRunPlainTextForCopy, formatDryRunEventMessage, type DryRunEvent, type DryRunState } from '../ttl/dryRun'
import {
  buildSendPlainTextForCopy,
  countUnresolvedSendEntries,
  renderSendPayloadHtml,
} from '../ttl/sendText'
import type { FlowchartModel } from '../ttl/flowchart'
import type { AnalysisLimitations } from '../ttl/analysisLimitations'
import { FLUSHRECV_BEFORE_SEND_DIAG_CODE } from '../ttl/flushrecvWarningIgnores'
import { CONSECUTIVE_SEND_DIAG_CODE } from '../ttl/consecutiveSendWarningIgnores'
import { formatUnresolvedDisplay } from '../ttl/unresolvedDisplay'
import { mountFlowchart } from './flowchart/mountFlowchart'

export type SidePanelTab = 'setup' | 'sends' | 'dryrun' | 'flowchart' | 'variables'

export function createSidePanel(
  container: HTMLElement,
  options?: {
    dark?: boolean
    showDetailedWaits?: boolean
    showAssignments?: boolean
    checkFlushrecvBeforeSend?: boolean
    checkConsecutiveSend?: boolean
  },
): {
  update: (data: {
    analysis: AnalysisResult
    sendEntries: SendEntry[]
    indeterminateBranches?: IndeterminateIfBranch[]
    branchAssumptions?: Record<string, boolean>
    indeterminateVariables?: IndeterminateVariable[]
    variableAssumptions?: Record<string, string>
    flushrecvWarningIgnores?: Record<string, boolean>
    consecutiveSendWarningIgnores?: Record<string, boolean>
    checkFlushrecvBeforeSend?: boolean
    checkConsecutiveSend?: boolean
    analysisLimitations?: AnalysisLimitations
  }) => void
  updateDryRun: (state: DryRunState | null) => void
  updateFlowchart: (model: FlowchartModel | null) => void
  setFlowchartActiveLocation: (location: string | undefined) => void
  setFlowchartTheme: (dark: boolean) => void
  showTab: (tab: SidePanelTab) => void
  includeMount: HTMLElement
  onGotoLine: (handler: (line: number) => void) => void
  onGotoDryRunLocation: (handler: (location: string) => void) => void
  onGotoSendLocation: (handler: (location: string) => void) => void
  onGotoFlowchartLocation: (handler: (location: string) => void) => void
  onFlowchartDetailedWaitsChange: (handler: (show: boolean) => void) => void
  onFlowchartAssignmentsChange: (handler: (show: boolean) => void) => void
  onFlushrecvWarningIgnoreChange: (handler: (line: number, ignored: boolean) => void) => void
  onConsecutiveSendWarningIgnoreChange: (handler: (line: number, ignored: boolean) => void) => void
  onClearDryRun: (handler: () => void) => void
  onBranchAssumptionChange: (handler: (line: number, value: boolean | null) => void) => void
  onVariableAssumptionChange: (handler: (line: number, name: string, value: string | null) => void) => void
  refresh: () => void
  syncViewOptions: (options: { showDetailedWaits?: boolean; showAssignments?: boolean }) => void
} {
  let gotoHandler: ((line: number) => void) | null = null
  let dryRunGotoHandler: ((location: string) => void) | null = null
  let sendGotoHandler: ((location: string) => void) | null = null
  let flowchartGotoHandler: ((location: string) => void) | null = null
  let flowchartDetailedWaitsHandler: ((show: boolean) => void) | null = null
  let flowchartAssignmentsHandler: ((show: boolean) => void) | null = null
  let flushrecvWarningIgnoreHandler: ((line: number, ignored: boolean) => void) | null = null
  let consecutiveSendWarningIgnoreHandler: ((line: number, ignored: boolean) => void) | null = null
  let clearDryRunHandler: (() => void) | null = null
  let branchAssumptionHandler: ((line: number, value: boolean | null) => void) | null = null
  let variableAssumptionHandler: ((line: number, name: string, value: string | null) => void) | null = null
  let activeTab: SidePanelTab = 'setup'
  let cached: {
    analysis: AnalysisResult
    sendEntries: SendEntry[]
    indeterminateBranches: IndeterminateIfBranch[]
    branchAssumptions: Record<string, boolean>
    indeterminateVariables: IndeterminateVariable[]
    variableAssumptions: Record<string, string>
    flushrecvWarningIgnores: Record<string, boolean>
    consecutiveSendWarningIgnores: Record<string, boolean>
    checkFlushrecvBeforeSend: boolean
    checkConsecutiveSend: boolean
    analysisLimitations: AnalysisLimitations
  } | null = null
  let dryRunState: DryRunState | null = null
  let flowchartModel: FlowchartModel | null = null
  let showDetailedWaits = options?.showDetailedWaits ?? false
  let showAssignments = options?.showAssignments ?? false
  let checkFlushrecvBeforeSend = options?.checkFlushrecvBeforeSend ?? false
  let checkConsecutiveSend = options?.checkConsecutiveSend ?? false
  let setupWarningDetailsOpen = false

  container.innerHTML = ''

  const tabs = document.createElement('div')
  tabs.className = 'side-panel-tabs'
  tabs.innerHTML = `
    <button type="button" class="side-panel-tab active" data-tab="setup">前提</button>
    <button type="button" class="side-panel-tab" data-tab="sends">送信データ</button>
    <button type="button" class="side-panel-tab" data-tab="dryrun">ドライラン</button>
    <button type="button" class="side-panel-tab" data-tab="flowchart">フロー</button>
    <button type="button" class="side-panel-tab" data-tab="variables">変数</button>
  `

  const header = document.createElement('div')
  header.className = 'panel-header'
  header.innerHTML = `
    <div class="panel-header-row">
      <h2 id="side-panel-title">前提</h2>
      <div class="panel-action-group">
        <button type="button" id="send-copy-btn" class="panel-action-btn" title="送信データをプレーンテキストでコピー（未解決部分はプレースホルダー付き）">コピー</button>
        <button type="button" id="dryrun-copy-btn" class="panel-action-btn" hidden title="ドライランのログをプレーンテキストでコピー">コピー</button>
        <button type="button" id="dryrun-clear-btn" class="panel-action-btn" hidden title="ドライランのログをクリア">クリア</button>
      </div>
    </div>
    <div class="panel-stats" id="side-panel-stats"></div>
  `

  const body = document.createElement('div')
  body.className = 'side-panel-body'

  const analysisWarning = document.createElement('div')
  analysisWarning.className = 'analysis-limitations-warning'
  analysisWarning.hidden = true

  const variableList = document.createElement('div')
  variableList.className = 'variable-list'
  variableList.id = 'variable-list'
  variableList.hidden = true

  const sendList = document.createElement('div')
  sendList.className = 'send-list'
  sendList.id = 'send-list'
  sendList.hidden = true

  const dryRunList = document.createElement('div')
  dryRunList.className = 'dryrun-list'
  dryRunList.id = 'dryrun-list'
  dryRunList.hidden = true

  const flowchartToolbar = document.createElement('div')
  flowchartToolbar.className = 'flowchart-toolbar'
  flowchartToolbar.id = 'flowchart-toolbar'
  flowchartToolbar.hidden = true
  flowchartToolbar.innerHTML = `
    <button type="button" id="flowchart-waits-btn" class="panel-action-btn" title="詳細な受信待機コマンドの表示を切り替え"></button>
    <button type="button" id="flowchart-assignments-btn" class="panel-action-btn" title="変数への代入の表示を切り替え"></button>
  `

  const flowchartHost = document.createElement('div')
  flowchartHost.className = 'flowchart-host'
  flowchartHost.id = 'flowchart-host'
  flowchartHost.hidden = true

  const flowchartWarnings = document.createElement('div')
  flowchartWarnings.className = 'flowchart-warnings'
  flowchartWarnings.id = 'flowchart-warnings'
  flowchartWarnings.hidden = true

  const setupPanel = document.createElement('div')
  setupPanel.className = 'setup-panel'
  setupPanel.id = 'setup-panel'

  const includeMount = document.createElement('div')
  includeMount.className = 'include-mount'
  includeMount.id = 'include-mount'

  const analysisOptionsSection = document.createElement('div')
  analysisOptionsSection.className = 'analysis-options-section'
  analysisOptionsSection.hidden = true
  analysisOptionsSection.innerHTML = `
    <div class="flushrecv-warning-ignores-section" id="flushrecv-warning-ignores-section" hidden>
      <h3 class="flushrecv-warning-ignores-title">無視した解析警告</h3>
      <div class="flushrecv-warning-ignores-list" id="flushrecv-warning-ignores-list"></div>
    </div>
  `

  const variableSection = document.createElement('div')
  variableSection.className = 'variable-assumptions-section'
  variableSection.id = 'variable-assumptions-section'
  variableSection.innerHTML = `
    <h2>未確定変数</h2>
    <p class="branch-assumptions-hint">静的に値が決まらない変数のうち、原因となる代入だけを表示します。参照や連結で派生した変数は、原因側の仮定が伝われば足ります。値を入力すると送信データ・変数ホバーに反映されます。ドライランの実行値は変わりません。</p>
    <div class="variable-assumptions-list" id="variable-assumptions-list"></div>
  `

  const branchSection = document.createElement('div')
  branchSection.className = 'branch-assumptions-section'
  branchSection.id = 'branch-assumptions-section'
  branchSection.innerHTML = `
    <h2>未確定分岐</h2>
    <p class="branch-assumptions-hint">静的に真偽が決まらない if / elseif です。True / False を選ぶと送信データ・変数ホバーに反映されます。</p>
    <div class="branch-assumptions-list" id="branch-assumptions-list"></div>
  `

  setupPanel.append(analysisOptionsSection, variableSection, branchSection, includeMount)
  body.append(setupPanel, variableList, sendList, dryRunList, flowchartToolbar, flowchartHost, flowchartWarnings)

  const diagSection = document.createElement('div')
  diagSection.className = 'diagnostics-section'
  diagSection.innerHTML = `<h2>診断</h2><div class="diagnostics-summary" id="diagnostics-summary" hidden></div><div class="diagnostics-list" id="diagnostics-list"></div>`

  const sendCopyBtn = header.querySelector<HTMLButtonElement>('#send-copy-btn')!
  const dryRunCopyBtn = header.querySelector<HTMLButtonElement>('#dryrun-copy-btn')!
  const dryRunClearBtn = header.querySelector<HTMLButtonElement>('#dryrun-clear-btn')!
  const flowchartWaitsBtn = flowchartToolbar.querySelector<HTMLButtonElement>('#flowchart-waits-btn')!
  const flowchartAssignmentsBtn = flowchartToolbar.querySelector<HTMLButtonElement>('#flowchart-assignments-btn')!
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

  container.append(tabs, header, analysisWarning, body, diagSection)
  const flowchart = mountFlowchart(flowchartHost, {
    dark: options?.dark ?? true,
    onGotoLocation(location) {
      flowchartGotoHandler?.(location)
    },
  })

  function updateFlowchartWaitsButton() {
    flowchartWaitsBtn.textContent = `受信詳細: ${showDetailedWaits ? 'ON' : 'OFF'}`
    flowchartWaitsBtn.setAttribute('aria-pressed', String(showDetailedWaits))
  }
  function updateFlowchartAssignmentsButton() {
    flowchartAssignmentsBtn.textContent = `代入: ${showAssignments ? 'ON' : 'OFF'}`
    flowchartAssignmentsBtn.setAttribute('aria-pressed', String(showAssignments))
  }
  updateFlowchartWaitsButton()
  updateFlowchartAssignmentsButton()
  flowchartWaitsBtn.addEventListener('click', () => {
    showDetailedWaits = !showDetailedWaits
    updateFlowchartWaitsButton()
    flowchartDetailedWaitsHandler?.(showDetailedWaits)
  })
  flowchartAssignmentsBtn.addEventListener('click', () => {
    showAssignments = !showAssignments
    updateFlowchartAssignmentsButton()
    flowchartAssignmentsHandler?.(showAssignments)
  })

  function isDryRunCopyAvailable(state: DryRunState | null): boolean {
    if (!state) return false
    return buildDryRunPlainTextForCopy(state).length > 0
  }

  function clearCopyFeedbackTimer() {
    if (copyFeedbackTimer) {
      clearTimeout(copyFeedbackTimer)
      copyFeedbackTimer = null
    }
  }

  function setDryRunCopyEnabled() {
    dryRunCopyBtn.disabled = !isDryRunCopyAvailable(dryRunState)
  }

  function renderFlowchartWarnings() {
    if (activeTab !== 'flowchart' || !flowchartModel?.warnings.length) {
      flowchartWarnings.hidden = true
      flowchartWarnings.innerHTML = ''
      return
    }
    flowchartWarnings.hidden = false
    flowchartWarnings.innerHTML = flowchartModel.warnings
      .map((warning) => `<div class="flowchart-warning-item">${escapeHtml(warning)}</div>`)
      .join('')
  }

  function setTab(tab: SidePanelTab) {
    activeTab = tab
    for (const btn of tabs.querySelectorAll<HTMLButtonElement>('.side-panel-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tab)
    }
    variableList.hidden = tab !== 'variables'
    setupPanel.hidden = tab !== 'setup'
    sendList.hidden = tab !== 'sends'
    dryRunList.hidden = tab !== 'dryrun'
    flowchartToolbar.hidden = tab !== 'flowchart'
    flowchartHost.hidden = tab !== 'flowchart'
    sendCopyBtn.hidden = tab !== 'sends'
    dryRunCopyBtn.hidden = tab !== 'dryrun'
    dryRunClearBtn.hidden = tab !== 'dryrun'
    flowchart.setVisible(tab === 'flowchart')
    diagSection.hidden = tab === 'flowchart'
    const title = container.querySelector('#side-panel-title')!
    title.textContent =
      tab === 'setup'
        ? '前提'
        : tab === 'variables'
          ? '変数'
          : tab === 'sends'
            ? '送信データ'
            : tab === 'dryrun'
              ? 'ドライラン'
              : 'フローチャート'
    if (tab === 'dryrun' && dryRunState) renderDryRun(dryRunState)
    else if (tab === 'dryrun') {
      updateStats(cached?.analysis ?? { variables: [], diagnostics: [] }, cached?.sendEntries ?? [])
    } else if (tab === 'flowchart') {
      updateStats(cached?.analysis ?? { variables: [], diagnostics: [] }, cached?.sendEntries ?? [])
      renderFlowchartWarnings()
    } else {
      updateStats(cached?.analysis ?? { variables: [], diagnostics: [] }, cached?.sendEntries ?? [])
    }
    renderAnalysisWarning(cached?.analysisLimitations)
    renderFlowchartWarnings()
  }

  tabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.side-panel-tab')
    if (!btn?.dataset.tab) return
    setTab(btn.dataset.tab as SidePanelTab)
    if (cached) render(cached)
  })

  function updateStats(analysis: AnalysisResult, sendEntries: SendEntry[]) {
    const statsEl = container.querySelector('#side-panel-stats')!
    if (activeTab === 'dryrun') {
      if (!dryRunState) {
        statsEl.textContent = '未実行'
        setDryRunCopyEnabled()
        return
      }
      const statusLabel =
        dryRunState.status === 'running'
          ? '実行中'
          : dryRunState.status === 'waiting-dialog'
            ? '対話待ち'
            : dryRunState.status === 'finished'
              ? '完了'
              : dryRunState.status === 'stopped'
                ? '停止'
                : dryRunState.status === 'error'
                  ? 'エラー'
                  : '待機'
      statsEl.textContent = `${statusLabel} / L${dryRunState.currentLine || '-'} / ${dryRunState.events.length} 件`
      setDryRunCopyEnabled()
      return
    }
    if (activeTab === 'flowchart') {
      if (!flowchartModel) {
        statsEl.textContent = '解析待ち'
      } else {
        const warningText =
          flowchartModel.warnings.length > 0 ? ` / 注意 ${flowchartModel.warnings.length}` : ''
        statsEl.textContent = `ノード ${flowchartModel.nodes.length} / エッジ ${flowchartModel.edges.length}${warningText}`
      }
      return
    }
    if (activeTab === 'setup') {
      if (!cached) {
        statsEl.textContent = '解析待ち'
        return
      }
      const snapshot = cached
      const varCount = snapshot.indeterminateVariables.length
      const unsetVars = snapshot.indeterminateVariables.filter(
        (variable) =>
          snapshot.variableAssumptions[variableAssumptionKey(variable.line, variable.name)]
            === undefined,
      ).length
      const branchCount = snapshot.indeterminateBranches.length
      const unselected = snapshot.indeterminateBranches.filter(
        (branch) => snapshot.branchAssumptions[String(branch.line)] === undefined,
      ).length
      const unlinked = snapshot.analysisLimitations.unlinkedIncludes.length
      statsEl.textContent =
        `未確定変数 ${varCount}（未入力 ${unsetVars}） / 未確定分岐 ${branchCount}（未選択 ${unselected}） / 未リンク include ${unlinked}`
      return
    }
    if (activeTab === 'variables') {
      const userVars = analysis.variables.filter((v) => !v.isSystem)
      const sysVars = analysis.variables.filter((v) => v.isSystem)
      statsEl.textContent = `ユーザー ${userVars.length} / システム ${sysVars.length}`
    } else {
      const sendlnCount = sendEntries.filter((e) => e.command === 'sendln').length
      const sendCount = sendEntries.filter((e) => e.command === 'send').length
      const otherSendCount = sendEntries.length - sendCount - sendlnCount
      const unresolvedCount = countUnresolvedSendEntries(sendEntries)
      const loopExpanded = sendEntries.some((e) => e.loopInfo)
      const otherLabel = otherSendCount > 0 ? ` / その他 ${otherSendCount}` : ''
      const base =
        loopExpanded
          ? `合計 ${sendEntries.length} 件（send ${sendCount} / sendln ${sendlnCount}${otherLabel}、ループ展開）`
          : `send ${sendCount} / sendln ${sendlnCount}${otherLabel}`
      statsEl.textContent =
        unresolvedCount > 0 ? `${base}（未解決 ${unresolvedCount}）` : base
      sendCopyBtn.disabled = sendEntries.length === 0
    }
  }

  function showCopyFeedback(message: string, tab: SidePanelTab = activeTab) {
    if (activeTab !== tab) return
    const statsEl = container.querySelector('#side-panel-stats')!
    statsEl.textContent = message
    clearCopyFeedbackTimer()
    copyFeedbackTimer = setTimeout(() => {
      if (activeTab === 'dryrun' && dryRunState) {
        updateStats(cached?.analysis ?? { variables: [], diagnostics: [] }, cached?.sendEntries ?? [])
      } else if (cached) {
        updateStats(cached.analysis, cached.sendEntries)
      }
    }, 2000)
  }

  async function copyResolvedSendText() {
    if (!cached) return
    const tabAtClick: SidePanelTab = 'sends'
    const text = buildSendPlainTextForCopy(cached.sendEntries)
    if (!text && cached.sendEntries.length === 0) {
      showCopyFeedback('コピーできる送信データがありません', tabAtClick)
      return
    }
    const ok = await copyToClipboard(text)
    if (activeTab !== tabAtClick) return
    const unresolved = countUnresolvedSendEntries(cached.sendEntries)
    const msg =
      unresolved > 0
        ? `送信データをコピーしました（未解決 ${unresolved} 件を含む）`
        : '送信データをコピーしました'
    showCopyFeedback(ok ? msg : 'コピーに失敗しました', tabAtClick)
  }

  sendCopyBtn.addEventListener('click', () => {
    void copyResolvedSendText()
  })

  async function copyDryRunText() {
    const tabAtClick: SidePanelTab = 'dryrun'
    if (!dryRunState) {
      showCopyFeedback('コピーできるドライランのログがありません', tabAtClick)
      return
    }
    const snapshot = dryRunState
    const text = buildDryRunPlainTextForCopy(snapshot)
    if (!text) {
      showCopyFeedback('コピーできるドライランのログがありません', tabAtClick)
      return
    }
    const ok = await copyToClipboard(text)
    if (dryRunState !== snapshot || activeTab !== tabAtClick) return
    showCopyFeedback(ok ? 'ドライランのログをコピーしました' : 'コピーに失敗しました', tabAtClick)
  }

  dryRunCopyBtn.addEventListener('click', () => {
    void copyDryRunText()
  })

  dryRunClearBtn.addEventListener('click', () => {
    clearCopyFeedbackTimer()
    clearDryRunHandler?.()
  })

  function renderDryRun(state: DryRunState) {
    updateStats(cached?.analysis ?? { variables: [], diagnostics: [] }, cached?.sendEntries ?? [])
    setDryRunCopyEnabled()
    if (state.events.length === 0) {
      dryRunList.innerHTML = '<div class="empty-state">ログはまだありません</div>'
      return
    }
    dryRunList.innerHTML = state.events.map(renderDryRunEvent).join('')
    bindDryRunGotoHandlers()
    const last = dryRunList.lastElementChild
    last?.scrollIntoView({ block: 'nearest' })
  }

  function renderDryRunEvent(event: DryRunEvent): string {
    const kindClass = `dryrun-kind-${event.kind}`
    const gotoBtn =
      event.line > 0
        ? `<button type="button" class="dryrun-goto" data-location="${escapeAttr(event.location)}" title="行へ移動">⌖</button>`
        : ''
  const displayPayload =
      !event.maskPayload && event.payload !== undefined
        ? formatUnresolvedDisplay(event.payload)
        : undefined
  const payload =
      displayPayload !== undefined
        ? `<div class="dryrun-payload">${renderSendPayloadHtml(displayPayload)}${event.addsNewline ? '<span class="send-nl-mark">↵</span>' : ''}</div>`
        : ''
    return `
      <div class="dryrun-item ${kindClass}">
        <div class="dryrun-item-header">
          <span class="dryrun-location">${escapeHtml(event.location)}</span>
          <span class="dryrun-kind">${escapeHtml(event.kind)}</span>
          ${gotoBtn}
        </div>
        <div class="dryrun-message">${escapeHtml(formatDryRunEventMessage(event))}</div>
        ${payload}
        ${event.detail ? `<div class="dryrun-detail">${escapeHtml(event.detail)}</div>` : ''}
      </div>
    `
  }

  function bindDryRunGotoHandlers() {
    for (const btn of dryRunList.querySelectorAll<HTMLButtonElement>('.dryrun-goto')) {
      btn.addEventListener('click', () => {
        const location = btn.dataset.location
        if (dryRunGotoHandler && location) dryRunGotoHandler(location)
      })
    }
  }

  function renderVariableList(analysis: AnalysisResult) {
    if (analysis.variables.length === 0) {
      variableList.innerHTML = '<div class="empty-state">変数がありません</div>'
    } else {
      variableList.innerHTML = analysis.variables.map(renderVariable).join('')
      bindVariableGotoHandlers()
    }
  }

  function renderSendList(sendEntries: SendEntry[]) {
    if (sendEntries.length === 0) {
      sendList.innerHTML = '<div class="empty-state">送信データはありません</div>'
    } else {
      sendList.innerHTML = sendEntries.map(renderSend).join('')
      bindSendGotoHandlers()
    }
  }

  function renderAnalysisWarning(limitations: AnalysisLimitations | undefined) {
    const openDetails = analysisWarning.querySelector<HTMLDetailsElement>(
      'details.analysis-limitations-details',
    )
    if (openDetails) setupWarningDetailsOpen = openDetails.open

    const showUnassumedBranches =
      (activeTab === 'setup' || activeTab === 'sends')
      && (limitations?.unassumedBranches.length ?? 0) > 0
    const showUnlinkedIncludes =
      (activeTab === 'setup' || activeTab === 'sends' || activeTab === 'flowchart')
      && (limitations?.unlinkedIncludes.length ?? 0) > 0
    const shouldShow =
      !!limitations && (showUnassumedBranches || showUnlinkedIncludes)
    analysisWarning.hidden = !shouldShow
    if (!shouldShow || !limitations) {
      analysisWarning.innerHTML = ''
      analysisWarning.className = 'analysis-limitations-warning'
      return
    }

    const summaryParts: string[] = []
    if (showUnassumedBranches) {
      summaryParts.push(`未確定分岐 ${limitations.unassumedBranches.length} 件`)
    }
    if (showUnlinkedIncludes) {
      summaryParts.push(`未リンク include ${limitations.unlinkedIncludes.length} 件`)
    }
    const summaryText = summaryParts.join('、')

    const helpText =
      activeTab === 'flowchart'
        ? 'include の参照タブを指定してください。分岐仮定・変数仮定はフロー表示に影響しません。'
        : activeTab === 'sends'
          ? '「前提」タブで未確定分岐の True/False、include の参照タブを指定してください。'
          : '下の各セクションで値を入力・選択してください。'

    if (activeTab === 'setup') {
      analysisWarning.className = 'analysis-limitations-warning analysis-limitations-warning--setup'
      analysisWarning.innerHTML = `
        <details class="analysis-limitations-details">
          <summary class="analysis-limitations-title">⚠ 解析条件が不足しています（${summaryText}）</summary>
          <div class="analysis-limitations-details-body">
            <div>解析条件が不足しているため、表示内容が正しい結果にならない可能性があります。</div>
            <div class="analysis-limitations-help">${helpText}</div>
          </div>
        </details>
      `
      const details = analysisWarning.querySelector<HTMLDetailsElement>(
        'details.analysis-limitations-details',
      )
      if (details) details.open = setupWarningDetailsOpen
      return
    }

    const items: string[] = []
    if (showUnassumedBranches) {
      items.push(
        `<li>True/False 未選択の分岐: ${limitations.unassumedBranches.length} 件</li>`,
      )
    }
    if (showUnlinkedIncludes) {
      items.push(
        `<li>タブ未指定の include: ${limitations.unlinkedIncludes.length} 件</li>`,
      )
    }
    analysisWarning.className = 'analysis-limitations-warning'
    analysisWarning.innerHTML = `
      <div class="analysis-limitations-title">⚠ 解析結果は暫定です</div>
      <div>解析条件が不足しているため、表示内容が正しい結果にならない可能性があります。</div>
      <ul>${items.join('')}</ul>
      <div class="analysis-limitations-help">${helpText}</div>
    `
  }

  function renderBranchAssumptions(
    branches: IndeterminateIfBranch[],
    assumptions: Record<string, boolean>,
  ) {
    const section = container.querySelector<HTMLElement>('#branch-assumptions-section')!
    const list = container.querySelector<HTMLElement>('#branch-assumptions-list')!
    if (activeTab !== 'setup') {
      return
    }
    section.hidden = false
    if (branches.length === 0) {
      list.innerHTML = '<div class="empty-state">未確定分岐はありません</div>'
      return
    }
    list.innerHTML = branches
      .map((branch) => {
        const key = String(branch.line)
        const assumed = assumptions[key]
        const trueActive = assumed === true ? ' active' : ''
        const falseActive = assumed === false ? ' active' : ''
        const clearHidden = assumed === undefined ? ' hidden' : ''
        return `
          <div class="branch-assumption-item panel-goto-item" data-line="${branch.line}" title="L${branch.line} へ移動">
            <div class="branch-assumption-head">
              <span class="branch-assumption-line">L${branch.line}</span>
              <span class="branch-assumption-cmd">${escapeHtml(branch.command)}</span>
            </div>
            <div class="branch-assumption-cond">${escapeHtml(branch.conditionText)}</div>
            <div class="branch-assumption-actions">
              <button type="button" class="branch-assumption-btn true${trueActive}" data-line="${branch.line}" data-value="true">True</button>
              <button type="button" class="branch-assumption-btn false${falseActive}" data-line="${branch.line}" data-value="false">False</button>
              <button type="button" class="branch-assumption-btn clear${clearHidden}" data-line="${branch.line}" data-value="clear">クリア</button>
            </div>
          </div>
        `
      })
      .join('')

    for (const btn of list.querySelectorAll<HTMLButtonElement>('.branch-assumption-btn')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const line = Number(btn.dataset.line)
        if (!Number.isFinite(line) || line <= 0) return
        const value = btn.dataset.value
        if (value === 'true') branchAssumptionHandler?.(line, true)
        else if (value === 'false') branchAssumptionHandler?.(line, false)
        else branchAssumptionHandler?.(line, null)
      })
    }
    bindPanelGotoItems(list)
  }

  function renderVariableAssumptions(
    variables: IndeterminateVariable[],
    assumptions: Record<string, string>,
  ) {
    const section = container.querySelector<HTMLElement>('#variable-assumptions-section')!
    const list = container.querySelector<HTMLElement>('#variable-assumptions-list')!
    if (activeTab !== 'setup') {
      return
    }
    section.hidden = false
    if (variables.length === 0) {
      list.innerHTML = '<div class="empty-state">未確定変数はありません</div>'
      return
    }
    list.innerHTML = variables
      .map((variable) => {
        const key = variableAssumptionKey(variable.line, variable.name)
        const assumed = assumptions[key]
        const hasValue = assumed !== undefined
        const clearHidden = hasValue ? '' : ' hidden'
        const typeLabel = variable.valueType === 'integer' ? 'integer' : 'string'
        return `
          <div class="variable-assumption-item panel-goto-item" data-line="${variable.line}" title="L${variable.line} へ移動">
            <div class="branch-assumption-head">
              <span class="branch-assumption-line">L${variable.line}</span>
              <span class="branch-assumption-cmd">${escapeHtml(variable.name)}</span>
              <span class="variable-assumption-type">${typeLabel}</span>
            </div>
            <div class="branch-assumption-cond">${escapeHtml(formatUnresolvedDisplay(variable.reason))}</div>
            <div class="variable-assumption-actions">
              <input
                type="text"
                class="variable-assumption-input"
                data-line="${variable.line}"
                data-name="${escapeAttr(variable.name)}"
                data-type="${variable.valueType}"
                value="${escapeAttr(assumed ?? '')}"
                placeholder="${variable.valueType === 'integer' ? '整数を入力' : '文字列を入力'}"
                spellcheck="false"
              />
              <button type="button" class="branch-assumption-btn apply" data-line="${variable.line}" data-name="${escapeAttr(variable.name)}">適用</button>
              <button type="button" class="branch-assumption-btn clear${clearHidden}" data-line="${variable.line}" data-name="${escapeAttr(variable.name)}" data-value="clear">クリア</button>
            </div>
          </div>
        `
      })
      .join('')

    const commitInput = (input: HTMLInputElement, mode: 'blur' | 'apply' | 'clear' = 'blur') => {
      const line = Number(input.dataset.line)
      const name = input.dataset.name ?? ''
      if (!Number.isFinite(line) || line <= 0 || !name) return
      const key = variableAssumptionKey(line, name)
      const current = assumptions[key]
      const next = input.value
      if (mode === 'clear') {
        if (current !== undefined) variableAssumptionHandler?.(line, name, null)
        return
      }
      const valueType = input.dataset.type === 'integer' ? 'integer' : 'string'
      if (next.trim() === '') {
        if (current !== undefined) variableAssumptionHandler?.(line, name, null)
        return
      }
      if (!isValidVariableAssumptionInput(valueType, next)) {
        if (mode === 'blur') input.value = current ?? ''
        return
      }
      if (mode === 'blur' && next === (current ?? '')) return
      variableAssumptionHandler?.(line, name, next)
    }

    for (const input of list.querySelectorAll<HTMLInputElement>('.variable-assumption-input')) {
      input.addEventListener('click', (e) => e.stopPropagation())
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commitInput(input, 'apply')
        }
      })
      input.addEventListener('blur', () => commitInput(input, 'blur'))
    }
    for (const btn of list.querySelectorAll<HTMLButtonElement>('.branch-assumption-btn')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const item = btn.closest('.variable-assumption-item')
        const input = item?.querySelector<HTMLInputElement>('.variable-assumption-input')
        if (!input) return
        if (btn.dataset.value === 'clear') commitInput(input, 'clear')
        else commitInput(input, 'apply')
      })
    }
    bindPanelGotoItems(list)
  }

  function ignoredLines(record: Record<string, boolean>): number[] {
    return Object.entries(record)
      .filter(([, value]) => value)
      .map(([key]) => Number(key))
      .filter((line) => Number.isFinite(line) && line > 0)
      .sort((a, b) => a - b)
  }

  function renderLintWarningIgnores(
    flushrecvIgnores: Record<string, boolean>,
    consecutiveIgnores: Record<string, boolean>,
  ) {
    const section = container.querySelector<HTMLElement>('#flushrecv-warning-ignores-section')!
    const list = container.querySelector<HTMLElement>('#flushrecv-warning-ignores-list')!
    const items: Array<{ line: number; label: string; code: string }> = []
    if (checkFlushrecvBeforeSend) {
      for (const line of ignoredLines(flushrecvIgnores)) {
        items.push({ line, label: 'flushrecv', code: FLUSHRECV_BEFORE_SEND_DIAG_CODE })
      }
    }
    if (checkConsecutiveSend) {
      for (const line of ignoredLines(consecutiveIgnores)) {
        items.push({ line, label: '連続 send', code: CONSECUTIVE_SEND_DIAG_CODE })
      }
    }
    items.sort((a, b) => a.line - b.line || a.label.localeCompare(b.label, 'ja'))

    if (items.length === 0) {
      section.hidden = true
      analysisOptionsSection.hidden = true
      list.innerHTML = ''
      return
    }

    analysisOptionsSection.hidden = false
    section.hidden = false
    list.innerHTML = items
      .map(
        (item) => `
          <div class="flushrecv-warning-ignore-item panel-goto-item" data-line="${item.line}" title="L${item.line} へ移動">
            <span class="branch-assumption-line">L${item.line}</span>
            <span class="variable-assumption-type">${escapeHtml(item.label)}</span>
            <button type="button" class="branch-assumption-btn clear flushrecv-warning-unignore-btn" data-line="${item.line}" data-code="${escapeAttr(item.code)}">解除</button>
          </div>
        `,
      )
      .join('')

    bindPanelGotoItems(list)
    for (const btn of list.querySelectorAll<HTMLButtonElement>('.flushrecv-warning-unignore-btn')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const line = Number(btn.dataset.line)
        const code = btn.dataset.code
        if (!Number.isFinite(line) || line <= 0) return
        if (code === CONSECUTIVE_SEND_DIAG_CODE) consecutiveSendWarningIgnoreHandler?.(line, false)
        else flushrecvWarningIgnoreHandler?.(line, false)
      })
    }
  }

  function renderDiagnostics(analysis: AnalysisResult) {
    const errors = analysis.diagnostics.filter((d) => d.severity === 'error').length
    const warnings = analysis.diagnostics.filter((d) => d.severity === 'warning').length
    const diagEl = container.querySelector('#diagnostics-list')!
    const summaryEl = container.querySelector<HTMLElement>('#diagnostics-summary')!
    if (analysis.diagnostics.length === 0) {
      summaryEl.hidden = true
      summaryEl.innerHTML = ''
      diagEl.innerHTML = '<div class="empty-state success">問題は見つかりませんでした</div>'
    } else {
      summaryEl.hidden = false
      summaryEl.innerHTML = `${errors > 0 ? `<span class="err-count">${errors} エラー</span>` : ''}${warnings > 0 ? `<span class="warn-count">${warnings} 警告</span>` : ''}`
      diagEl.innerHTML = analysis.diagnostics.map(renderDiagnostic).join('')
      bindDiagnosticGotoHandlers()
    }
  }

  function render(data: {
    analysis: AnalysisResult
    sendEntries: SendEntry[]
    indeterminateBranches: IndeterminateIfBranch[]
    branchAssumptions: Record<string, boolean>
    indeterminateVariables: IndeterminateVariable[]
    variableAssumptions: Record<string, string>
    flushrecvWarningIgnores: Record<string, boolean>
    consecutiveSendWarningIgnores: Record<string, boolean>
    checkFlushrecvBeforeSend: boolean
    checkConsecutiveSend: boolean
    analysisLimitations: AnalysisLimitations
  }) {
    const {
      analysis,
      sendEntries,
      indeterminateBranches,
      branchAssumptions,
      indeterminateVariables,
      variableAssumptions,
      flushrecvWarningIgnores,
      consecutiveSendWarningIgnores,
      checkFlushrecvBeforeSend: checkFlushrecvOption,
      checkConsecutiveSend: checkConsecutiveOption,
      analysisLimitations,
    } = data
    checkFlushrecvBeforeSend = checkFlushrecvOption
    checkConsecutiveSend = checkConsecutiveOption
    updateStats(analysis, sendEntries)
    renderAnalysisWarning(analysisLimitations)

    if (activeTab === 'variables') {
      renderVariableList(analysis)
    }
    if (activeTab === 'sends') {
      renderSendList(sendEntries)
    }
    if (activeTab === 'setup') {
      renderVariableAssumptions(indeterminateVariables, variableAssumptions)
      renderBranchAssumptions(indeterminateBranches, branchAssumptions)
      renderLintWarningIgnores(flushrecvWarningIgnores, consecutiveSendWarningIgnores)
    }
    if (activeTab !== 'flowchart') {
      renderDiagnostics(analysis)
    }
  }

  function renderVariable(v: VariableInfo): string {
    const typeClass =
      v.type === 'integer' ? 'type-int' : v.type === 'string' ? 'type-str' : v.type === 'array' ? 'type-array' : 'type-unknown'
    const badge = v.isSystem ? '<span class="badge system">system</span>' : ''
    const unused = !v.isUsed && !v.isSystem && v.declaredAt > 0 ? '<span class="badge unused">未使用</span>' : ''
    const gotoLine = v.declaredAt > 0 ? v.declaredAt : (v.usedAt[0] ?? 0)
    const clickable = gotoLine > 0 ? ' panel-goto-item' : ''

    return `
      <div class="variable-item ${v.isSystem ? 'system-var' : ''}${clickable}"${gotoLine > 0 ? ` data-line="${gotoLine}" title="L${gotoLine} へ移動"` : ''}>
        <div class="var-name">${escapeHtml(v.name)} ${badge}${unused}</div>
        <div class="var-meta">
          <span class="var-type ${typeClass}">${v.type}</span>
          ${v.declaredAt > 0 ? `<span class="var-line">L${v.declaredAt}</span>` : ''}
          ${v.usedAt.length > 0 ? `<span class="var-usage">${v.usedAt.length}回使用</span>` : ''}
        </div>
      </div>
    `
  }

  function renderSend(entry: SendEntry, index: number): string {
    const displayPayload = entry.payload ? formatUnresolvedDisplay(entry.payload) : ''
    const payloadHtml = displayPayload ? renderSendPayloadHtml(displayPayload) : '（空）'
    const newlineBadge = entry.addsNewline ? '<span class="badge send-nl">+改行</span>' : ''
    const unresolved = entry.unresolved ? '<span class="badge unused">未解決</span>' : ''
    const loopBadge = entry.loopInfo
      ? `<span class="badge send-loop" title="for ${escapeAttr(entry.loopInfo.variable)} ループ展開">${escapeHtml(entry.loopInfo.variable)}=${entry.loopInfo.value} (${entry.loopInfo.index}/${entry.loopInfo.total})</span>`
      : ''
    const gotoBtn =
      entry.location
        ? `<button type="button" class="send-goto" data-location="${escapeAttr(entry.location)}" title="行へ移動">⌖</button>`
        : ''
    const payloadTitle = entry.rawArgs ? ` title="${escapeAttr(entry.rawArgs)}"` : ''

    return `
      <div class="send-item" data-index="${index}">
        <div class="send-item-header">
          <span class="send-location">${escapeHtml(entry.location)}</span>
          <span class="send-cmd">${entry.command}</span>
          ${loopBadge}
          ${gotoBtn}
        </div>
        <div class="send-payload"${payloadTitle}>${payloadHtml}${entry.addsNewline ? '<span class="send-nl-mark">↵</span>' : ''}</div>
        <div class="send-meta">
          ${newlineBadge}${unresolved}
        </div>
      </div>
    `
  }

  function renderDiagnostic(d: { severity: string; message: string; line: number; code?: string }): string {
    const clickable = d.line > 0 ? ' panel-goto-item' : ''
    const canIgnoreFlushrecv =
      checkFlushrecvBeforeSend && d.code === FLUSHRECV_BEFORE_SEND_DIAG_CODE
    const canIgnoreConsecutive =
      checkConsecutiveSend && d.code === CONSECUTIVE_SEND_DIAG_CODE
    const ignoreTitle = canIgnoreConsecutive
      ? 'この行の連続 send 警告を無視'
      : 'この行の flushrecv 警告を無視'
    const ignoreBtn =
      canIgnoreFlushrecv || canIgnoreConsecutive
        ? `<button type="button" class="diagnostic-ignore-btn branch-assumption-btn" data-line="${d.line}" data-code="${escapeAttr(d.code ?? '')}" title="${escapeAttr(ignoreTitle)}">無視</button>`
        : ''
    return `
      <div class="diagnostic-item severity-${d.severity}${clickable}"${d.line > 0 ? ` data-line="${d.line}" title="L${d.line} へ移動"` : ''}>
        <span class="diag-icon">${d.severity === 'error' ? '✕' : d.severity === 'warning' ? '⚠' : 'ℹ'}</span>
        <span class="diag-line">L${d.line}</span>
        <span class="diag-msg">${escapeHtml(d.message)}</span>
        ${ignoreBtn ? `<span class="diag-actions">${ignoreBtn}</span>` : ''}
      </div>
    `
  }

  function bindPanelGotoItems(root: ParentNode) {
    for (const el of root.querySelectorAll<HTMLElement>('.panel-goto-item[data-line]')) {
      el.addEventListener('click', () => {
        const line = Number(el.dataset.line)
        if (gotoHandler && Number.isFinite(line) && line > 0) gotoHandler(line)
      })
    }
  }

  function bindVariableGotoHandlers() {
    bindPanelGotoItems(variableList)
  }

  function bindDiagnosticGotoHandlers() {
    const list = container.querySelector('#diagnostics-list')!
    bindPanelGotoItems(list)
    for (const btn of list.querySelectorAll<HTMLButtonElement>('.diagnostic-ignore-btn')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const line = Number(btn.dataset.line)
        const code = btn.dataset.code
        if (!Number.isFinite(line) || line <= 0) return
        if (code === CONSECUTIVE_SEND_DIAG_CODE) consecutiveSendWarningIgnoreHandler?.(line, true)
        else flushrecvWarningIgnoreHandler?.(line, true)
      })
    }
  }

  function bindSendGotoHandlers() {
    for (const btn of sendList.querySelectorAll<HTMLButtonElement>('.send-goto')) {
      btn.addEventListener('click', () => {
        const location = btn.dataset.location
        if (sendGotoHandler && location) sendGotoHandler(location)
      })
    }
  }

  return {
    includeMount,
    onGotoLine(handler) {
      gotoHandler = handler
    },
    onGotoDryRunLocation(handler) {
      dryRunGotoHandler = handler
    },
    onGotoSendLocation(handler) {
      sendGotoHandler = handler
    },
    onGotoFlowchartLocation(handler) {
      flowchartGotoHandler = handler
    },
    onFlowchartDetailedWaitsChange(handler) {
      flowchartDetailedWaitsHandler = handler
    },
    onFlowchartAssignmentsChange(handler) {
      flowchartAssignmentsHandler = handler
    },
    onFlushrecvWarningIgnoreChange(handler) {
      flushrecvWarningIgnoreHandler = handler
    },
    onConsecutiveSendWarningIgnoreChange(handler) {
      consecutiveSendWarningIgnoreHandler = handler
    },
    onClearDryRun(handler) {
      clearDryRunHandler = handler
    },
    onBranchAssumptionChange(handler) {
      branchAssumptionHandler = handler
    },
    onVariableAssumptionChange(handler) {
      variableAssumptionHandler = handler
    },
    showTab(tab) {
      setTab(tab)
      if (cached) render(cached)
    },
    update({
      analysis,
      sendEntries,
      indeterminateBranches = [],
      branchAssumptions = {},
      indeterminateVariables = [],
      variableAssumptions = {},
      flushrecvWarningIgnores = {},
      consecutiveSendWarningIgnores = {},
      checkFlushrecvBeforeSend: checkFlushrecvOption = false,
      checkConsecutiveSend: checkConsecutiveOption = false,
      analysisLimitations = { unassumedBranches: [], unassumedVariables: [], unlinkedIncludes: [] },
    }) {
      cached = {
        analysis,
        sendEntries,
        indeterminateBranches,
        branchAssumptions,
        indeterminateVariables,
        variableAssumptions,
        flushrecvWarningIgnores,
        consecutiveSendWarningIgnores,
        checkFlushrecvBeforeSend: checkFlushrecvOption,
        checkConsecutiveSend: checkConsecutiveOption,
        analysisLimitations,
      }
      render(cached)
    },
    updateDryRun(state) {
      dryRunState = state
      const currentLocation =
        state?.currentLocation && /^L\d+$/.test(state.currentLocation) && flowchartModel
          ? `${flowchartModel.rootSourceId}:${state.currentLocation}`
          : state?.currentLocation
      flowchart.setActiveLocation(currentLocation)
      if (activeTab === 'dryrun') {
        renderDryRun(state ?? { status: 'idle', currentLine: 0, events: [] })
      }
    },
    updateFlowchart(model) {
      flowchartModel = model
      flowchart.update(model)
      if (activeTab === 'flowchart') {
        updateStats(cached?.analysis ?? { variables: [], diagnostics: [] }, cached?.sendEntries ?? [])
        renderFlowchartWarnings()
      }
    },
    setFlowchartActiveLocation(location) {
      flowchart.setActiveLocation(location)
    },
    setFlowchartTheme(dark) {
      flowchart.setTheme(dark)
    },
    refresh() {
      if (cached) render(cached)
      if (activeTab === 'dryrun') {
        renderDryRun(dryRunState ?? { status: 'idle', currentLine: 0, events: [] })
      }
    },
    syncViewOptions(options) {
      if (options.showDetailedWaits !== undefined) {
        showDetailedWaits = options.showDetailedWaits
        updateFlowchartWaitsButton()
      }
      if (options.showAssignments !== undefined) {
        showAssignments = options.showAssignments
        updateFlowchartAssignmentsButton()
      }
    },
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text)
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  }
}
