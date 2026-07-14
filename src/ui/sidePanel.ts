import type { AnalysisResult, VariableInfo } from '../ttl/analyzer'
import type { SendEntry } from '../ttl/evaluator'
import { buildDryRunPlainTextForCopy, formatDryRunEventMessage, type DryRunEvent, type DryRunState } from '../ttl/dryRun'
import { buildSendPlainTextForCopy, countUnresolvedSendEntries } from '../ttl/sendText'
import type { FlowchartModel } from '../ttl/flowchart'
import { mountFlowchart } from './flowchart/mountFlowchart'

export type SidePanelTab = 'variables' | 'sends' | 'dryrun' | 'flowchart'

export function createSidePanel(
  container: HTMLElement,
  options?: { dark?: boolean; showDetailedWaits?: boolean; showAssignments?: boolean },
): {
  update: (data: { analysis: AnalysisResult; sendEntries: SendEntry[] }) => void
  updateDryRun: (state: DryRunState | null) => void
  updateFlowchart: (model: FlowchartModel | null) => void
  setFlowchartActiveLocation: (location: string | undefined) => void
  setFlowchartTheme: (dark: boolean) => void
  showTab: (tab: SidePanelTab) => void
  onGotoLine: (handler: (line: number) => void) => void
  onGotoDryRunLocation: (handler: (location: string) => void) => void
  onGotoSendLocation: (handler: (location: string) => void) => void
  onGotoFlowchartLocation: (handler: (location: string) => void) => void
  onFlowchartDetailedWaitsChange: (handler: (show: boolean) => void) => void
  onFlowchartAssignmentsChange: (handler: (show: boolean) => void) => void
  onClearDryRun: (handler: () => void) => void
} {
  let gotoHandler: ((line: number) => void) | null = null
  let dryRunGotoHandler: ((location: string) => void) | null = null
  let sendGotoHandler: ((location: string) => void) | null = null
  let flowchartGotoHandler: ((location: string) => void) | null = null
  let flowchartDetailedWaitsHandler: ((show: boolean) => void) | null = null
  let flowchartAssignmentsHandler: ((show: boolean) => void) | null = null
  let clearDryRunHandler: (() => void) | null = null
  let activeTab: SidePanelTab = 'sends'
  let cached: { analysis: AnalysisResult; sendEntries: SendEntry[] } | null = null
  let dryRunState: DryRunState | null = null
  let flowchartModel: FlowchartModel | null = null
  let showDetailedWaits = options?.showDetailedWaits ?? false
  let showAssignments = options?.showAssignments ?? false

  container.innerHTML = ''

  const tabs = document.createElement('div')
  tabs.className = 'side-panel-tabs'
  tabs.innerHTML = `
    <button type="button" class="side-panel-tab active" data-tab="sends">送信データ</button>
    <button type="button" class="side-panel-tab" data-tab="dryrun">ドライラン</button>
    <button type="button" class="side-panel-tab" data-tab="flowchart">フロー</button>
    <button type="button" class="side-panel-tab" data-tab="variables">変数</button>
  `

  const header = document.createElement('div')
  header.className = 'panel-header'
  header.innerHTML = `
    <div class="panel-header-row">
      <h2 id="side-panel-title">送信データ</h2>
      <button type="button" id="send-copy-btn" class="panel-action-btn" title="送信データをプレーンテキストでコピー（未解決部分はプレースホルダー付き）">コピー</button>
      <button type="button" id="dryrun-copy-btn" class="panel-action-btn" hidden title="ドライランのログをプレーンテキストでコピー">コピー</button>
      <button type="button" id="dryrun-clear-btn" class="panel-action-btn" hidden title="ドライランのログをクリア">クリア</button>
    </div>
    <div class="panel-stats" id="side-panel-stats"></div>
  `

  const body = document.createElement('div')
  body.className = 'side-panel-body'

  const variableList = document.createElement('div')
  variableList.className = 'variable-list'
  variableList.id = 'variable-list'
  variableList.hidden = true

  const sendList = document.createElement('div')
  sendList.className = 'send-list'
  sendList.id = 'send-list'

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

  body.append(variableList, sendList, dryRunList, flowchartToolbar, flowchartHost, flowchartWarnings)

  const diagSection = document.createElement('div')
  diagSection.className = 'diagnostics-section'
  diagSection.innerHTML = `<h2>診断</h2><div class="diagnostics-list" id="diagnostics-list"></div>`

  const sendCopyBtn = header.querySelector<HTMLButtonElement>('#send-copy-btn')!
  const dryRunCopyBtn = header.querySelector<HTMLButtonElement>('#dryrun-copy-btn')!
  const dryRunClearBtn = header.querySelector<HTMLButtonElement>('#dryrun-clear-btn')!
  const flowchartWaitsBtn = flowchartToolbar.querySelector<HTMLButtonElement>('#flowchart-waits-btn')!
  const flowchartAssignmentsBtn = flowchartToolbar.querySelector<HTMLButtonElement>('#flowchart-assignments-btn')!
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

  container.append(tabs, header, body, diagSection)
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
    sendList.hidden = tab !== 'sends'
    dryRunList.hidden = tab !== 'dryrun'
    flowchartToolbar.hidden = tab !== 'flowchart'
    flowchartHost.hidden = tab !== 'flowchart'
    sendCopyBtn.hidden = tab !== 'sends'
    dryRunCopyBtn.hidden = tab !== 'dryrun'
    dryRunClearBtn.hidden = tab !== 'dryrun'
    flowchart.setVisible(tab === 'flowchart')
    diagSection.hidden = tab === 'flowchart'
    container.querySelector<HTMLElement>('.include-section')?.toggleAttribute('hidden', tab === 'flowchart')
    const title = container.querySelector('#side-panel-title')!
    title.textContent =
      tab === 'variables'
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
    if (activeTab === 'variables') {
      const userVars = analysis.variables.filter((v) => !v.isSystem)
      const sysVars = analysis.variables.filter((v) => v.isSystem)
      statsEl.textContent = `ユーザー ${userVars.length} / システム ${sysVars.length}`
    } else {
      const sendlnCount = sendEntries.filter((e) => e.command === 'sendln').length
      const sendCount = sendEntries.filter((e) => e.command === 'send').length
      const unresolvedCount = countUnresolvedSendEntries(sendEntries)
      const loopExpanded = sendEntries.some((e) => e.loopInfo)
      const base =
        loopExpanded
          ? `合計 ${sendEntries.length} 件（send ${sendCount} / sendln ${sendlnCount}、ループ展開）`
          : `send ${sendCount} / sendln ${sendlnCount}`
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
      !event.maskPayload && event.payload !== undefined ? event.payload : undefined
  const payload =
      displayPayload !== undefined
        ? `<div class="dryrun-payload">${escapeHtml(displayPayload)}${event.addsNewline ? '<span class="send-nl-mark">↵</span>' : ''}</div>`
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
      sendList.innerHTML = '<div class="empty-state">send / sendln はありません</div>'
    } else {
      sendList.innerHTML = sendEntries.map(renderSend).join('')
      bindSendGotoHandlers()
    }
  }

  function renderDiagnostics(analysis: AnalysisResult) {
    const errors = analysis.diagnostics.filter((d) => d.severity === 'error').length
    const warnings = analysis.diagnostics.filter((d) => d.severity === 'warning').length
    const diagEl = container.querySelector('#diagnostics-list')!
    if (analysis.diagnostics.length === 0) {
      diagEl.innerHTML = '<div class="empty-state success">問題は見つかりませんでした</div>'
    } else {
      const summary = `<div class="diag-summary">${errors > 0 ? `<span class="err-count">${errors} エラー</span>` : ''}${warnings > 0 ? `<span class="warn-count">${warnings} 警告</span>` : ''}</div>`
      diagEl.innerHTML = summary + analysis.diagnostics.map(renderDiagnostic).join('')
      bindDiagnosticGotoHandlers()
    }
  }

  function render(data: { analysis: AnalysisResult; sendEntries: SendEntry[] }) {
    const { analysis, sendEntries } = data
    updateStats(analysis, sendEntries)

    if (activeTab === 'variables') {
      renderVariableList(analysis)
    }
    if (activeTab === 'sends') {
      renderSendList(sendEntries)
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
    const payload = entry.payload || '（空）'
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
        <div class="send-payload"${payloadTitle}>${escapeHtml(payload)}${entry.addsNewline ? '<span class="send-nl-mark">↵</span>' : ''}</div>
        <div class="send-meta">
          ${newlineBadge}${unresolved}
        </div>
      </div>
    `
  }

  function renderDiagnostic(d: { severity: string; message: string; line: number }): string {
    const clickable = d.line > 0 ? ' panel-goto-item' : ''
    return `
      <div class="diagnostic-item severity-${d.severity}${clickable}"${d.line > 0 ? ` data-line="${d.line}" title="L${d.line} へ移動"` : ''}>
        <span class="diag-icon">${d.severity === 'error' ? '✕' : d.severity === 'warning' ? '⚠' : 'ℹ'}</span>
        <span class="diag-line">L${d.line}</span>
        <span class="diag-msg">${escapeHtml(d.message)}</span>
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
    bindPanelGotoItems(container.querySelector('#diagnostics-list')!)
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
    onClearDryRun(handler) {
      clearDryRunHandler = handler
    },
    showTab(tab) {
      setTab(tab)
      if (cached) render(cached)
    },
    update({ analysis, sendEntries }) {
      cached = { analysis, sendEntries }
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
