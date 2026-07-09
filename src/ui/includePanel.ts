import type { EditorTab } from './tabManager'
import {
  getIncludeBindingKey,
  getLoopIncludeCommonTabId,
  includeLoopIterationBindingKey,
  includeLoopLineBindingKey,
  isIncludeRefLinked,
  resolveIncludeBindingTabId,
  type IncludeRef,
} from '../ttl/includeRefs'

export interface IncludePanelActions {
  onBindingChange: (path: string, tabId: string | null) => void
  onGotoLine: (line: number) => void
  onOpenLinkedTab: (tabId: string) => void
}

export function createIncludePanel(container: HTMLElement): {
  update: (refs: IncludeRef[], tab: EditorTab, otherTabs: EditorTab[], actions: IncludePanelActions) => void
} {
  const section = document.createElement('div')
  section.className = 'include-section'
  section.innerHTML = `<h2>インクルード</h2><div class="include-list" id="include-list"></div>`
  const anchor = container.querySelector('.diagnostics-section')
  if (anchor) container.insertBefore(section, anchor)
  else container.appendChild(section)

  const listEl = section.querySelector('#include-list') as HTMLElement

  return {
    update(refs, tab, otherTabs, actions) {
      if (refs.length === 0) {
        listEl.innerHTML = '<div class="empty-state">include はありません</div>'
        return
      }

      listEl.innerHTML = refs
        .map((ref) => renderIncludeItem(ref, tab, otherTabs, actions))
        .join('')

      for (const el of listEl.querySelectorAll<HTMLSelectElement>('.include-link-select')) {
        el.addEventListener('change', () => {
          const path = el.dataset.path!
          const tabId = el.value || null
          actions.onBindingChange(path, tabId)
        })
      }

      for (const el of listEl.querySelectorAll<HTMLButtonElement>('.include-goto-line')) {
        el.addEventListener('click', () => {
          actions.onGotoLine(Number(el.dataset.line))
        })
      }

      for (const el of listEl.querySelectorAll<HTMLButtonElement>('.include-open-tab')) {
        el.addEventListener('click', () => {
          actions.onOpenLinkedTab(el.dataset.tabId!)
        })
      }
    },
  }
}

function renderTabOptions(otherTabs: EditorTab[], selectedId: string): string {
  return [
    `<option value="">（未リンク）</option>`,
    ...otherTabs.map(
      (t) =>
        `<option value="${escapeAttr(t.id)}"${t.id === selectedId ? ' selected' : ''}>${escapeHtml(t.fileName)}</option>`,
    ),
  ].join('')
}

function renderIncludeItem(
  ref: IncludeRef,
  tab: EditorTab,
  otherTabs: EditorTab[],
  _actions: IncludePanelActions,
): string {
  const pathLabel = ref.path ? escapeHtml(ref.path) : escapeHtml(ref.raw || '（引数なし）')
  const linked = isIncludeRefLinked(ref, tab.includeBindings)

  if (!ref.path && !ref.isDynamic) {
    return `
      <div class="include-item include-item-dynamic">
        <div class="include-item-header">
          <span class="include-line">L${ref.line}</span>
          <span class="include-path">${pathLabel}</span>
          <button type="button" class="include-goto-line" data-line="${ref.line}" title="行へ移動">⌖</button>
        </div>
        <div class="include-item-note">引数がないためタブ紐づけできません</div>
      </div>
    `
  }

  if (ref.loopContext) {
    const { variable, values } = ref.loopContext
    const commonKey = includeLoopLineBindingKey(ref.line)
    const commonTabId = getLoopIncludeCommonTabId(ref, tab.includeBindings)
    const perIterationOverrides = values.filter((v) =>
      !!tab.includeBindings[includeLoopIterationBindingKey(ref.line, v)],
    ).length
    const linkedCount = values.filter((v) =>
      !!resolveIncludeBindingTabId(
        tab.includeBindings,
        includeLoopIterationBindingKey(ref.line, v),
        ref.raw,
      ),
    ).length
    const openBtn = commonTabId
      ? `<button type="button" class="include-open-tab" data-tab-id="${escapeAttr(commonTabId)}" title="リンク先タブを開く">→</button>`
      : ''
    const iterationRows = values
      .map((v) => {
        const bindingKey = includeLoopIterationBindingKey(ref.line, v)
        const linkedTabId = tab.includeBindings[bindingKey] ?? ''
        const iterOpenBtn = linkedTabId
          ? `<button type="button" class="include-open-tab" data-tab-id="${escapeAttr(linkedTabId)}" title="リンク先タブを開く">→</button>`
          : ''
        return `
          <div class="include-loop-row">
            <span class="include-loop-label">${escapeHtml(variable)}=${v}</span>
            <label class="include-link-label">
              <select class="include-link-select" data-path="${escapeAttr(bindingKey)}">${renderTabOptions(otherTabs, linkedTabId)}</select>
            </label>
            ${iterOpenBtn}
          </div>
        `
      })
      .join('')

    const detailsOpen = perIterationOverrides > 0 ? ' open' : ''

    return `
      <div class="include-item include-item-loop${linked ? ' linked' : ''}">
        <div class="include-item-header">
          <span class="include-line">L${ref.line}</span>
          <span class="include-path" title="${escapeAttr(ref.raw)}">${pathLabel}</span>
          <button type="button" class="include-goto-line" data-line="${ref.line}" title="行へ移動">⌖</button>
        </div>
        <div class="include-item-note">for ループ内（${linkedCount}/${values.length} 件リンク済）</div>
        <div class="include-item-link include-loop-common">
          <label class="include-link-label">
            <span>全反復</span>
            <select class="include-link-select" data-path="${escapeAttr(commonKey)}">${renderTabOptions(otherTabs, commonTabId)}</select>
          </label>
          ${openBtn}
        </div>
        <details class="include-loop-details"${detailsOpen}>
          <summary>反復ごとに個別指定（${perIterationOverrides} 件）</summary>
          <div class="include-loop-bindings">${iterationRows}</div>
        </details>
      </div>
    `
  }

  const bindingKey = getIncludeBindingKey(ref)
  if (!bindingKey) return ''

  const linkedTabId = tab.includeBindings[bindingKey] ?? ''
  const openBtn = linkedTabId
    ? `<button type="button" class="include-open-tab" data-tab-id="${escapeAttr(linkedTabId)}" title="リンク先タブを開く">→</button>`
    : ''

  const dynamicNote = ref.isDynamic
    ? '<div class="include-item-note">変数指定（引数名で紐づけ・行の増減に追従）</div>'
    : ''

  const itemClass = ref.isDynamic
    ? `include-item include-item-dynamic${linked ? ' linked' : ''}`
    : `include-item${linked ? ' linked' : ''}`

  return `
    <div class="${itemClass}">
      <div class="include-item-header">
        <span class="include-line">L${ref.line}</span>
        <span class="include-path" title="${escapeAttr(ref.path ?? ref.raw)}">${pathLabel}</span>
        <button type="button" class="include-goto-line" data-line="${ref.line}" title="行へ移動">⌖</button>
      </div>
      ${dynamicNote}
      <div class="include-item-link">
        <label class="include-link-label">
          <span>タブ</span>
          <select class="include-link-select" data-path="${escapeAttr(bindingKey)}">${renderTabOptions(otherTabs, linkedTabId)}</select>
        </label>
        ${openBtn}
      </div>
    </div>
  `
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
