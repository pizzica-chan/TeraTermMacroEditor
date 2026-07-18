/** ドライラン専用: 実行前に値が分からない分岐の仮定（TTL yesnobox とは別 UI） */

import { dryRunBranchDialogCopy } from '../ttl/dryRunBranchCopy'

let activeOverlay: HTMLElement | null = null
let activeCancel: (() => void) | null = null

function closeActive(): void {
  activeOverlay?.remove()
  activeOverlay = null
  activeCancel = null
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface DryRunBranchAssumptionPrompt {
  location: string
  command: string
  conditionText: string
}

export function showDryRunBranchAssumptionDialog(
  options: DryRunBranchAssumptionPrompt,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean | null) => {
      if (settled) return
      settled = true
      closeActive()
      resolve(value)
    }

    closeActive()
    const copy = dryRunBranchDialogCopy(options.command)
    const overlay = document.createElement('div')
    overlay.className = 'dryrun-branch-overlay'
    overlay.innerHTML = `
      <div class="dryrun-branch-dialog" role="dialog" aria-label="ドライラン: 分岐の選択">
        <div class="dryrun-branch-badge">ドライラン（エディタ）</div>
        <h3 class="dryrun-branch-title">${escapeHtml(copy.title)}</h3>
        <p class="dryrun-branch-lead">${escapeHtml(copy.lead)}</p>
        <p class="dryrun-branch-note">※ マクロの yesnobox ではありません。今回のドライラン実行にだけ適用されます。</p>
        <div class="dryrun-branch-location">${escapeHtml(options.location)}</div>
        <div class="dryrun-branch-condition-label">条件式</div>
        <pre class="dryrun-branch-condition">${escapeHtml(options.conditionText || '（条件）')}</pre>
        <div class="dryrun-branch-actions">
          <button type="button" class="dryrun-branch-btn" data-action="false">${escapeHtml(copy.falseLabel)}</button>
          <button type="button" class="dryrun-branch-btn primary" data-action="true">${escapeHtml(copy.trueLabel)}</button>
        </div>
        <button type="button" class="dryrun-branch-cancel" data-action="cancel">キャンセル（ドライラン停止）</button>
      </div>
    `
    document.body.appendChild(overlay)
    activeOverlay = overlay
    activeCancel = () => finish(null)

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null)
    })
    overlay.querySelector('[data-action="false"]')!.addEventListener('click', () => finish(false))
    overlay.querySelector('[data-action="true"]')!.addEventListener('click', () => finish(true))
    overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => finish(null))
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    })
    overlay.querySelector<HTMLButtonElement>('[data-action="true"]')!.focus()
  })
}

export function cancelActiveDryRunBranchDialog(): void {
  activeCancel?.()
}
