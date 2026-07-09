import type { EditorTab } from './tabManager'
import type { IncludeRef } from '../ttl/includeRefs'
import { normalizeIncludePath } from '../ttl/includeRefs'

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

function renderIncludeItem(
  ref: IncludeRef,
  tab: EditorTab,
  otherTabs: EditorTab[],
  _actions: IncludePanelActions,
): string {
  const pathLabel = ref.path ? escapeHtml(ref.path) : escapeHtml(ref.raw || '（引数なし）')

  if (ref.isDynamic || !ref.path) {
    return `
      <div class="include-item include-item-dynamic">
        <div class="include-item-header">
          <span class="include-line">L${ref.line}</span>
          <span class="include-path">${pathLabel}</span>
        </div>
        <div class="include-item-note">変数指定のためタブ紐づけ不可</div>
      </div>
    `
  }

  const key = normalizeIncludePath(ref.path)
  const linkedTabId = tab.includeBindings[key] ?? ''
  const options = [
    `<option value="">（未リンク）</option>`,
    ...otherTabs.map(
      (t) =>
        `<option value="${escapeAttr(t.id)}"${t.id === linkedTabId ? ' selected' : ''}>${escapeHtml(t.fileName)}</option>`,
    ),
  ].join('')

  const openBtn = linkedTabId
    ? `<button type="button" class="include-open-tab" data-tab-id="${escapeAttr(linkedTabId)}" title="リンク先タブを開く">→</button>`
    : ''

  return `
    <div class="include-item${linkedTabId ? ' linked' : ''}">
      <div class="include-item-header">
        <span class="include-line">L${ref.line}</span>
        <span class="include-path" title="${escapeAttr(ref.path)}">${pathLabel}</span>
        <button type="button" class="include-goto-line" data-line="${ref.line}" title="行へ移動">⌖</button>
      </div>
      <div class="include-item-link">
        <label class="include-link-label">
          <span>タブ</span>
          <select class="include-link-select" data-path="${escapeAttr(key)}">${options}</select>
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
