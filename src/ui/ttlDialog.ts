import type {
  DryRunBranchAssumptionPrompt,
  DryRunDialogAdapter,
  ListboxKeywords,
} from '../ttl/dryRun'
import { DEFAULT_LISTBOX_KEYWORDS } from '../ttl/dryRun'
import {
  cancelActiveDryRunBranchDialog,
  showDryRunBranchAssumptionDialog,
} from './dryRunBranchDialog'
import { cancelActiveDryRunMacroArgvDialog } from './dryRunMacroArgvDialog'

type PendingResolver<T> = (value: T) => void

let activeOverlay: HTMLElement | null = null
let activeCancel: (() => void) | null = null

function closeActive(): void {
  activeOverlay?.remove()
  activeOverlay = null
  activeCancel = null
}

function createOverlay(title: string, bodyHtml: string, actionsHtml: string): HTMLElement {
  closeActive()
  const overlay = document.createElement('div')
  overlay.className = 'ttl-dialog-overlay'
  overlay.innerHTML = `
    <div class="ttl-dialog" role="dialog" aria-label="${escapeAttr(title)}">
      <h3 class="ttl-dialog-title">${escapeHtml(title)}</h3>
      <div class="ttl-dialog-body">${bodyHtml}</div>
      <div class="ttl-dialog-actions">${actionsHtml}</div>
    </div>
  `
  document.body.appendChild(overlay)
  activeOverlay = overlay
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) activeCancel?.()
  })
  return overlay
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

function waitForDialog<T>(setup: (resolve: PendingResolver<T | null>) => void): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      closeActive()
      resolve(value)
    }
    setup(finish)
    activeCancel = () => finish(null)
  })
}

function createListboxOverlay(
  title: string,
  bodyHtml: string,
  actionsHtml: string,
  keywords: ListboxKeywords,
): HTMLElement {
  closeActive()
  const showWindowButtons = keywords.minmaxbutton || keywords.minimize || keywords.maximize
  const windowButtons = showWindowButtons
    ? `
      <div class="ttl-dialog-window-btns">
        <button type="button" class="ttl-dialog-window-btn" data-action="minimize" title="最小化" aria-label="最小化">_</button>
        <button type="button" class="ttl-dialog-window-btn" data-action="maximize" title="最大化" aria-label="最大化">□</button>
      </div>
    `
    : ''
  const dialogClass = [
    'ttl-dialog',
    'ttl-dialog-listbox',
    keywords.maximize ? 'is-maximized' : '',
    keywords.minimize ? 'is-minimized' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const overlay = document.createElement('div')
  overlay.className = 'ttl-dialog-overlay'
  overlay.innerHTML = `
    <div class="${dialogClass}" role="dialog" aria-label="${escapeAttr(title)}">
      <div class="ttl-dialog-titlebar">
        <h3 class="ttl-dialog-title">${escapeHtml(title)}</h3>
        ${windowButtons}
      </div>
      <div class="ttl-dialog-body">${bodyHtml}</div>
      <div class="ttl-dialog-actions">${actionsHtml}</div>
    </div>
  `
  document.body.appendChild(overlay)
  activeOverlay = overlay
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) activeCancel?.()
  })

  const dialog = overlay.querySelector<HTMLElement>('.ttl-dialog')!
  const syncWindowButtonsVisibility = () => {
    const btns = overlay.querySelector('.ttl-dialog-window-btns')
    if (!btns) return
    const show =
      keywords.minmaxbutton ||
      keywords.minimize ||
      keywords.maximize ||
      dialog.classList.contains('is-minimized')
    btns.classList.toggle('is-hidden', !show)
  }
  syncWindowButtonsVisibility()

  overlay.querySelector('[data-action="minimize"]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    dialog.classList.add('is-minimized')
    dialog.classList.remove('is-maximized')
    syncWindowButtonsVisibility()
  })
  overlay.querySelector('[data-action="maximize"]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (dialog.classList.contains('is-minimized')) {
      dialog.classList.remove('is-minimized')
      if (keywords.maximize) dialog.classList.add('is-maximized')
    } else {
      dialog.classList.toggle('is-maximized')
    }
    syncWindowButtonsVisibility()
  })

  return overlay
}

export function cancelActiveTtlDialog(): void {
  activeCancel?.()
  cancelActiveDryRunBranchDialog()
  cancelActiveDryRunMacroArgvDialog()
}

export function createBrowserDialogAdapter(): DryRunDialogAdapter {
  return {
    yesno(message, title) {
      return waitForDialog<boolean>((resolve) => {
        const overlay = createOverlay(
          title,
          `<p class="ttl-dialog-message">${escapeHtml(message)}</p>`,
          `
            <button type="button" class="ttl-dialog-btn" data-action="no">いいえ</button>
            <button type="button" class="ttl-dialog-btn primary" data-action="yes">はい</button>
          `,
        )
        const focusYes = overlay.querySelector<HTMLButtonElement>('[data-action="yes"]')!
        overlay.querySelector('[data-action="no"]')!.addEventListener('click', () => resolve(false))
        focusYes.addEventListener('click', () => resolve(true))
        overlay.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            resolve(null)
          }
        })
        focusYes.focus()
      })
    },

    message(message, title) {
      return new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (value: boolean) => {
          if (settled) return
          settled = true
          closeActive()
          resolve(value)
        }
        activeCancel = () => finish(false)
        const overlay = createOverlay(
          title,
          `<p class="ttl-dialog-message">${escapeHtml(message)}</p>`,
          `<button type="button" class="ttl-dialog-btn primary" data-action="ok">OK</button>`,
        )
        const okBtn = overlay.querySelector<HTMLButtonElement>('[data-action="ok"]')!
        okBtn.addEventListener('click', () => finish(true))
        overlay.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            finish(true)
          }
        })
        okBtn.focus()
      })
    },

    input(message, title, defaultValue, password) {
      return waitForDialog<string>((resolve) => {
        const overlay = createOverlay(
          title,
          `
            <p class="ttl-dialog-message">${escapeHtml(message)}</p>
            <input class="ttl-dialog-input" type="${password ? 'password' : 'text'}" value="${escapeAttr(defaultValue)}" />
          `,
          `
            <button type="button" class="ttl-dialog-btn" data-action="cancel">キャンセル</button>
            <button type="button" class="ttl-dialog-btn primary" data-action="ok">OK</button>
          `,
        )
        const input = overlay.querySelector<HTMLInputElement>('.ttl-dialog-input')!
        overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => resolve(null))
        overlay.querySelector('[data-action="ok"]')!.addEventListener('click', () => resolve(input.value))
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            resolve(input.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            resolve(null)
          }
        })
        input.focus()
        input.select()
      })
    },

    list(message, title, items, selected, keywordsInput) {
      const keywords = { ...DEFAULT_LISTBOX_KEYWORDS, ...keywordsInput }
      return waitForDialog<number>((resolve) => {
        let highlighted =
          selected !== undefined && selected >= 0 && selected < items.length ? selected : undefined

        const listHtml = items
          .map((item, idx) => {
            const isSelected = highlighted === idx
            const cls = isSelected ? 'ttl-dialog-list-item is-selected' : 'ttl-dialog-list-item'
            const label = item === '' ? '（空）' : item
            return `<button type="button" class="${cls}" data-index="${idx}">${escapeHtml(label)}</button>`
          })
          .join('')
        const body = `
          <p class="ttl-dialog-message">${escapeHtml(message)}</p>
          <div class="ttl-dialog-list" style="width:${keywords.listboxWidth}ch;height:${keywords.listboxHeight * 1.8}em;max-height:none">${
            listHtml || '<p class="ttl-dialog-message">（項目なし）</p>'
          }</div>
        `
        const actions = keywords.dblclick
          ? `
            <button type="button" class="ttl-dialog-btn" data-action="cancel">キャンセル</button>
            <button type="button" class="ttl-dialog-btn primary" data-action="ok">OK</button>
          `
          : `<button type="button" class="ttl-dialog-btn" data-action="cancel">キャンセル</button>`

        const overlay = createListboxOverlay(title, body, actions, keywords)
        const listEl = overlay.querySelector<HTMLElement>('.ttl-dialog-list')!
        const okBtn = overlay.querySelector<HTMLButtonElement>('[data-action="ok"]')

        const setHighlight = (index: number) => {
          highlighted = index
          for (const btn of overlay.querySelectorAll<HTMLButtonElement>('.ttl-dialog-list-item')) {
            btn.classList.toggle('is-selected', Number(btn.dataset.index) === index)
          }
          if (okBtn) okBtn.disabled = false
        }

        const confirm = (index: number | undefined) => {
          if (index === undefined || index < 0 || index >= items.length) return
          resolve(index)
        }

        overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => resolve(null))
        okBtn?.addEventListener('click', () => confirm(highlighted))
        if (okBtn && highlighted === undefined) okBtn.disabled = true

        for (const btn of overlay.querySelectorAll<HTMLButtonElement>('.ttl-dialog-list-item')) {
          btn.addEventListener('click', () => {
            const index = Number(btn.dataset.index)
            if (keywords.dblclick) {
              setHighlight(index)
              btn.focus()
            } else {
              resolve(index)
            }
          })
          btn.addEventListener('dblclick', (e) => {
            if (!keywords.dblclick) return
            e.preventDefault()
            confirm(Number(btn.dataset.index))
          })
        }

        overlay.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            resolve(null)
          } else if (e.key === 'Enter' && keywords.dblclick) {
            e.preventDefault()
            confirm(highlighted)
          }
        })

        // 最大化時はリストを伸縮（インライン幅・高さより優先）
        if (keywords.maximize) {
          listEl.style.width = ''
          listEl.style.height = ''
        }

        const focusIdx = highlighted ?? 0
        overlay.querySelector<HTMLButtonElement>(`.ttl-dialog-list-item[data-index="${focusIdx}"]`)?.focus()
      })
    },

    filename(title, filter, defaultPath) {
      return new Promise<{ ok: boolean; path: string }>((resolve) => {
        let settled = false
        const finish = (value: { ok: boolean; path: string }) => {
          if (settled) return
          settled = true
          closeActive()
          resolve(value)
        }
        activeCancel = () => finish({ ok: false, path: '' })
        const overlay = createOverlay(
          title,
          `
            <p class="ttl-dialog-hint">フィルタ: ${escapeHtml(filter || '（なし）')}</p>
            <input class="ttl-dialog-input" type="text" value="${escapeAttr(defaultPath)}" placeholder="ファイルパス" />
          `,
          `
            <button type="button" class="ttl-dialog-btn" data-action="cancel">キャンセル</button>
            <button type="button" class="ttl-dialog-btn primary" data-action="ok">OK</button>
          `,
        )
        const input = overlay.querySelector<HTMLInputElement>('.ttl-dialog-input')!
        overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => finish({ ok: false, path: '' }))
        overlay.querySelector('[data-action="ok"]')!.addEventListener('click', () => finish({ ok: true, path: input.value }))
        input.focus()
      })
    },

    dirname(title, defaultPath) {
      return new Promise<{ ok: boolean; path: string }>((resolve) => {
        let settled = false
        const finish = (value: { ok: boolean; path: string }) => {
          if (settled) return
          settled = true
          closeActive()
          resolve(value)
        }
        activeCancel = () => finish({ ok: false, path: '' })
        const overlay = createOverlay(
          title,
          `<input class="ttl-dialog-input" type="text" value="${escapeAttr(defaultPath)}" placeholder="フォルダパス" />`,
          `
            <button type="button" class="ttl-dialog-btn" data-action="cancel">キャンセル</button>
            <button type="button" class="ttl-dialog-btn primary" data-action="ok">OK</button>
          `,
        )
        const input = overlay.querySelector<HTMLInputElement>('.ttl-dialog-input')!
        overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => finish({ ok: false, path: '' }))
        overlay.querySelector('[data-action="ok"]')!.addEventListener('click', () => finish({ ok: true, path: input.value }))
        input.focus()
      })
    },

    branchAssumption(options: DryRunBranchAssumptionPrompt) {
      return showDryRunBranchAssumptionDialog(options)
    },

    cancel() {
      cancelActiveTtlDialog()
    },
  }
}
