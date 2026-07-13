import type { DryRunDialogAdapter } from '../ttl/dryRun'

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

export function cancelActiveTtlDialog(): void {
  activeCancel?.()
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

    list(title, items) {
      return waitForDialog<number>((resolve) => {
        const listHtml = items
          .map(
            (item, idx) =>
              `<button type="button" class="ttl-dialog-list-item" data-index="${idx}">${escapeHtml(item)}</button>`,
          )
          .join('')
        const overlay = createOverlay(
          title,
          `<div class="ttl-dialog-list">${listHtml || '<p class="ttl-dialog-message">（項目なし）</p>'}</div>`,
          `<button type="button" class="ttl-dialog-btn" data-action="cancel">キャンセル</button>`,
        )
        overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => resolve(null))
        for (const btn of overlay.querySelectorAll<HTMLButtonElement>('.ttl-dialog-list-item')) {
          btn.addEventListener('click', () => resolve(Number(btn.dataset.index)))
        }
        overlay.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            resolve(null)
          }
        })
        overlay.querySelector<HTMLButtonElement>('.ttl-dialog-list-item')?.focus()
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

    cancel() {
      cancelActiveTtlDialog()
    },
  }
}
