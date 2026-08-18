import type { UnresolvedValueDisplay } from '../ttl/unresolvedDisplay'

export interface AppOptionsDialogValues {
  unresolvedValueDisplay: UnresolvedValueDisplay
  checkFlushrecvBeforeSend: boolean
  checkConsecutiveSend: boolean
}

export function showAppOptionsDialog(opts: {
  values: AppOptionsDialogValues
  onChange: (partial: Partial<AppOptionsDialogValues>) => void
}): void {
  document.querySelector('.app-settings-overlay')?.remove()

  const overlay = document.createElement('div')
  overlay.className = 'app-settings-overlay'
  overlay.innerHTML = `
    <div class="app-settings-dialog" role="dialog" aria-labelledby="app-settings-title">
      <h3 id="app-settings-title" class="app-settings-title">オプション</h3>
      <div class="app-settings-body">
        <fieldset class="app-settings-fieldset">
          <legend>表示</legend>
          <div class="app-settings-label">未確定値の表示</div>
          <p class="app-settings-hint">実行時まで決まらない部分を、式の連結として出すか、文字列の途中に <code>{…}</code> で示すかを選べます。</p>
          <label class="app-settings-choice">
            <input type="radio" name="unresolved-value-display" value="expression" />
            <span>
              <span class="app-settings-choice-title">連結式</span>
              <code class="app-settings-example">'hoge' + （getdate の出力）</code>
            </span>
          </label>
          <label class="app-settings-choice">
            <input type="radio" name="unresolved-value-display" value="embedded" />
            <span>
              <span class="app-settings-choice-title">埋め込み</span>
              <code class="app-settings-example">hoge{getdateの出力}</code>
            </span>
          </label>
        </fieldset>
        <fieldset class="app-settings-fieldset">
          <legend>解析</legend>
          <label class="app-settings-check">
            <input type="checkbox" id="opt-flushrecv-before-send" />
            <span>
              <span class="app-settings-choice-title">flushrecv チェック</span>
              <span class="app-settings-hint">send / sendln の前に flushrecv があるか検査します（flushrecv と wait 系の間に send が 2 つ以上あるときは 2 つ目以降も）。</span>
            </span>
          </label>
          <label class="app-settings-check">
            <input type="checkbox" id="opt-consecutive-send" />
            <span>
              <span class="app-settings-choice-title">連続 send チェック</span>
              <span class="app-settings-hint">send / sendln の間に wait 系（wait / waitln / recvln など）またはダイアログ（messagebox など）がないと警告します。</span>
            </span>
          </label>
        </fieldset>
      </div>
      <div class="app-settings-actions">
        <button type="button" class="app-settings-close">閉じる</button>
      </div>
    </div>
  `

  const displayRadios = overlay.querySelectorAll<HTMLInputElement>('input[name="unresolved-value-display"]')
  const flushrecv = overlay.querySelector<HTMLInputElement>('#opt-flushrecv-before-send')!
  const consecutiveSend = overlay.querySelector<HTMLInputElement>('#opt-consecutive-send')!

  for (const radio of displayRadios) {
    radio.checked = radio.value === opts.values.unresolvedValueDisplay
  }
  flushrecv.checked = opts.values.checkFlushrecvBeforeSend
  consecutiveSend.checked = opts.values.checkConsecutiveSend

  for (const radio of displayRadios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      const value = radio.value
      if (value !== 'expression' && value !== 'embedded') return
      opts.onChange({ unresolvedValueDisplay: value })
    })
  }
  flushrecv.addEventListener('change', () => {
    opts.onChange({ checkFlushrecvBeforeSend: flushrecv.checked })
  })
  consecutiveSend.addEventListener('change', () => {
    opts.onChange({ checkConsecutiveSend: consecutiveSend.checked })
  })

  const close = () => overlay.remove()
  overlay.querySelector('.app-settings-close')!.addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })

  document.body.appendChild(overlay)
  overlay.querySelector<HTMLButtonElement>('.app-settings-close')!.focus()
}
