import type { MacroArgvInput } from '../ttl/commandLineParams'
import { macroArgvFromDialogFields } from '../ttl/commandLineParams'

let activeOverlay: HTMLElement | null = null
let activeCancel: (() => void) | null = null

function closeActiveDomOnly(): void {
  activeOverlay?.remove()
  activeOverlay = null
  activeCancel = null
}

/** 表示中ダイアログがあれば cancel で Promise を解決してから閉じる */
function dismissActiveAsCancel(): void {
  const cancel = activeCancel
  if (cancel) {
    cancel()
    return
  }
  closeActiveDomOnly()
}

export function cancelActiveDryRunMacroArgvDialog(): void {
  dismissActiveAsCancel()
}

export type DryRunMacroArgvDialogResult =
  | { action: 'cancel' }
  | { action: 'start'; macroArgv?: MacroArgvInput }

/**
 * マクロが param / params / paramcnt を参照するときだけ呼ぶ。
 * 空のまま開始 → 方針 A（macroArgv なし）。キャンセル → ドライラン中止。
 */
export function showDryRunMacroArgvDialog(): Promise<DryRunMacroArgvDialogResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: DryRunMacroArgvDialogResult) => {
      if (settled) return
      settled = true
      closeActiveDomOnly()
      resolve(value)
    }

    // 再入時は前ダイアログの Promise を cancel 解決してから差し替え
    dismissActiveAsCancel()

    const overlay = document.createElement('div')
    overlay.className = 'ttl-dialog-overlay'
    overlay.innerHTML = `
      <div class="ttl-dialog" role="dialog" aria-label="ドライラン: マクロ起動引数">
        <h3 class="ttl-dialog-title">マクロ起動引数</h3>
        <div class="ttl-dialog-body">
          <p class="ttl-dialog-message">このマクロは param / params / paramcnt を参照しています。</p>
          <p class="ttl-dialog-hint">空のまま開始すると引数なし（エディタ既定）で実行します。追加引数は空白区切りです（引用符は未対応）。</p>
          <label class="ttl-dialog-field">
            <span class="ttl-dialog-field-label">ファイル名（param1）</span>
            <input class="ttl-dialog-input" data-field="file" type="text" placeholder="例: script.ttl" />
          </label>
          <label class="ttl-dialog-field">
            <span class="ttl-dialog-field-label">追加引数（param2…・空白区切り）</span>
            <input class="ttl-dialog-input" data-field="args" type="text" placeholder="例: user1 password" />
          </label>
        </div>
        <div class="ttl-dialog-actions">
          <button type="button" class="ttl-dialog-btn" data-action="cancel">キャンセル</button>
          <button type="button" class="ttl-dialog-btn primary" data-action="start">開始</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    activeOverlay = overlay

    const fileInput = overlay.querySelector<HTMLInputElement>('[data-field="file"]')!
    const argsInput = overlay.querySelector<HTMLInputElement>('[data-field="args"]')!

    const start = () => {
      finish({
        action: 'start',
        macroArgv: macroArgvFromDialogFields(fileInput.value, argsInput.value),
      })
    }

    overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
      finish({ action: 'cancel' })
    })
    overlay.querySelector('[data-action="start"]')!.addEventListener('click', start)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish({ action: 'cancel' })
    })
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish({ action: 'cancel' })
      }
      if (e.key === 'Enter' && !e.isComposing) {
        const target = e.target
        if (target instanceof HTMLElement && target.closest('[data-action="cancel"]')) return
        e.preventDefault()
        start()
      }
    })

    activeCancel = () => finish({ action: 'cancel' })
    fileInput.focus()
  })
}
