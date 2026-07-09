import type { AnalysisResult, VariableInfo } from '../ttl/analyzer'
import type { SendEntry } from '../ttl/evaluator'
import { buildResolvedSendPlainText, countResolvedSendEntries } from '../ttl/sendText'

export type SidePanelTab = 'variables' | 'sends'

export function createSidePanel(container: HTMLElement): {
  update: (data: { analysis: AnalysisResult; sendEntries: SendEntry[] }) => void
  onGotoLine: (handler: (line: number) => void) => void
} {
  let gotoHandler: ((line: number) => void) | null = null
  let activeTab: SidePanelTab = 'variables'
  let cached: { analysis: AnalysisResult; sendEntries: SendEntry[] } | null = null

  container.innerHTML = ''

  const tabs = document.createElement('div')
  tabs.className = 'side-panel-tabs'
  tabs.innerHTML = `
    <button type="button" class="side-panel-tab active" data-tab="variables">変数</button>
    <button type="button" class="side-panel-tab" data-tab="sends">送信データ</button>
  `

  const header = document.createElement('div')
  header.className = 'panel-header'
  header.innerHTML = `
    <div class="panel-header-row">
      <h2 id="side-panel-title">変数</h2>
      <button type="button" id="send-copy-btn" class="panel-action-btn" hidden title="静的に解決できた送信データをプレーンテキストでコピー">コピー</button>
    </div>
    <div class="panel-stats" id="side-panel-stats"></div>
  `

  const body = document.createElement('div')
  body.className = 'side-panel-body'

  const variableList = document.createElement('div')
  variableList.className = 'variable-list'
  variableList.id = 'variable-list'

  const sendList = document.createElement('div')
  sendList.className = 'send-list'
  sendList.id = 'send-list'
  sendList.hidden = true

  body.append(variableList, sendList)

  const diagSection = document.createElement('div')
  diagSection.className = 'diagnostics-section'
  diagSection.innerHTML = `<h2>診断</h2><div class="diagnostics-list" id="diagnostics-list"></div>`

  const sendCopyBtn = header.querySelector<HTMLButtonElement>('#send-copy-btn')!
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

  container.append(tabs, header, body, diagSection)

  function setTab(tab: SidePanelTab) {
    activeTab = tab
    for (const btn of tabs.querySelectorAll<HTMLButtonElement>('.side-panel-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tab)
    }
    variableList.hidden = tab !== 'variables'
    sendList.hidden = tab !== 'sends'
    sendCopyBtn.hidden = tab !== 'sends'
    const title = container.querySelector('#side-panel-title')!
    title.textContent = tab === 'variables' ? '変数' : '送信データ'
  }

  tabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.side-panel-tab')
    if (!btn?.dataset.tab) return
    setTab(btn.dataset.tab as SidePanelTab)
    if (cached) render(cached)
  })

  function updateStats(analysis: AnalysisResult, sendEntries: SendEntry[]) {
    const statsEl = container.querySelector('#side-panel-stats')!
    if (activeTab === 'variables') {
      const userVars = analysis.variables.filter((v) => !v.isSystem)
      const sysVars = analysis.variables.filter((v) => v.isSystem)
      statsEl.textContent = `ユーザー ${userVars.length} / システム ${sysVars.length}`
    } else {
      const sendlnCount = sendEntries.filter((e) => e.command === 'sendln').length
      const sendCount = sendEntries.filter((e) => e.command === 'send').length
      const resolvedCount = countResolvedSendEntries(sendEntries)
      statsEl.textContent = `send ${sendCount} / sendln ${sendlnCount}（コピー可 ${resolvedCount}）`
      sendCopyBtn.disabled = resolvedCount === 0
    }
  }

  function showCopyFeedback(message: string) {
    const statsEl = container.querySelector('#side-panel-stats')!
    statsEl.textContent = message
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
    copyFeedbackTimer = setTimeout(() => {
      if (cached) updateStats(cached.analysis, cached.sendEntries)
    }, 2000)
  }

  async function copyResolvedSendText() {
    if (!cached) return
    const text = buildResolvedSendPlainText(cached.sendEntries)
    if (!text) {
      showCopyFeedback('コピーできる送信データがありません')
      return
    }
    const ok = await copyToClipboard(text)
    showCopyFeedback(ok ? '送信データをコピーしました' : 'コピーに失敗しました')
  }

  sendCopyBtn.addEventListener('click', () => {
    void copyResolvedSendText()
  })

  function render(data: { analysis: AnalysisResult; sendEntries: SendEntry[] }) {
    const { analysis, sendEntries } = data
    updateStats(analysis, sendEntries)

    if (analysis.variables.length === 0) {
      variableList.innerHTML = '<div class="empty-state">変数がありません</div>'
    } else {
      variableList.innerHTML = analysis.variables.map(renderVariable).join('')
    }

    if (sendEntries.length === 0) {
      sendList.innerHTML = '<div class="empty-state">send / sendln はありません</div>'
    } else {
      sendList.innerHTML = sendEntries.map(renderSend).join('')
      bindSendGotoHandlers()
    }

    const errors = analysis.diagnostics.filter((d) => d.severity === 'error').length
    const warnings = analysis.diagnostics.filter((d) => d.severity === 'warning').length
    const diagEl = container.querySelector('#diagnostics-list')!
    if (analysis.diagnostics.length === 0) {
      diagEl.innerHTML = '<div class="empty-state success">問題は見つかりませんでした</div>'
    } else {
      const summary = `<div class="diag-summary">${errors > 0 ? `<span class="err-count">${errors} エラー</span>` : ''}${warnings > 0 ? `<span class="warn-count">${warnings} 警告</span>` : ''}</div>`
      diagEl.innerHTML = summary + analysis.diagnostics.map(renderDiagnostic).join('')
    }
  }

  function renderVariable(v: VariableInfo): string {
    const typeClass =
      v.type === 'integer' ? 'type-int' : v.type === 'string' ? 'type-str' : v.type === 'array' ? 'type-array' : 'type-unknown'
    const badge = v.isSystem ? '<span class="badge system">system</span>' : ''
    const unused = !v.isUsed && !v.isSystem && v.declaredAt > 0 ? '<span class="badge unused">未使用</span>' : ''

    return `
      <div class="variable-item ${v.isSystem ? 'system-var' : ''}">
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
    const displayPayload = entry.addsNewline ? `${escapeHtml(payload)}` : escapeHtml(payload)
    const newlineBadge = entry.addsNewline ? '<span class="badge send-nl">+改行</span>' : ''
    const unresolved = entry.unresolved ? '<span class="badge unused">未解決</span>' : ''
    const gotoLine = parseLocalLine(entry.location)
    const gotoBtn =
      gotoLine !== null
        ? `<button type="button" class="send-goto" data-line="${gotoLine}" title="行へ移動">⌖</button>`
        : ''

    return `
      <div class="send-item" data-index="${index}">
        <div class="send-item-header">
          <span class="send-location">${escapeHtml(entry.location)}</span>
          <span class="send-cmd">${entry.command}</span>
          ${gotoBtn}
        </div>
        <div class="send-payload">${displayPayload}${entry.addsNewline ? '<span class="send-nl-mark">↵</span>' : ''}</div>
        <div class="send-meta">
          ${newlineBadge}${unresolved}
          <span class="send-raw" title="${escapeAttr(entry.rawArgs)}">${escapeHtml(entry.rawArgs || '（引数なし）')}</span>
        </div>
      </div>
    `
  }

  function renderDiagnostic(d: { severity: string; message: string; line: number }): string {
    return `
      <div class="diagnostic-item severity-${d.severity}">
        <span class="diag-icon">${d.severity === 'error' ? '✕' : d.severity === 'warning' ? '⚠' : 'ℹ'}</span>
        <span class="diag-line">L${d.line}</span>
        <span class="diag-msg">${escapeHtml(d.message)}</span>
      </div>
    `
  }

  function bindSendGotoHandlers() {
    for (const btn of sendList.querySelectorAll<HTMLButtonElement>('.send-goto')) {
      btn.addEventListener('click', () => {
        const line = Number(btn.dataset.line)
        if (gotoHandler && Number.isFinite(line)) gotoHandler(line)
      })
    }
  }

  return {
    onGotoLine(handler) {
      gotoHandler = handler
    },
    update({ analysis, sendEntries }) {
      cached = { analysis, sendEntries }
      render(cached)
    },
  }
}

function parseLocalLine(location: string): number | null {
  const m = /^L(\d+)$/.exec(location)
  return m ? Number(m[1]) : null
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
