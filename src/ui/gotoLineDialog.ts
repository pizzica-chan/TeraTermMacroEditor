export function showGotoLineDialog(opts: {
  currentLine: number
  maxLine: number
  onSubmit: (line: number) => void
}): void {
  const existing = document.querySelector('.goto-line-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.className = 'goto-line-overlay'
  overlay.innerHTML = `
    <div class="goto-line-dialog" role="dialog" aria-label="行へ移動">
      <label class="goto-line-label" for="goto-line-input">行番号 (1–${opts.maxLine})</label>
      <input id="goto-line-input" class="goto-line-input" type="number" min="1" max="${opts.maxLine}" value="${opts.currentLine}" />
      <div class="goto-line-actions">
        <button type="button" class="goto-line-cancel">キャンセル</button>
        <button type="button" class="goto-line-ok">移動</button>
      </div>
    </div>
  `

  const input = overlay.querySelector<HTMLInputElement>('#goto-line-input')!
  const okBtn = overlay.querySelector<HTMLButtonElement>('.goto-line-ok')!
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('.goto-line-cancel')!

  const close = () => overlay.remove()

  const submit = () => {
    const line = Number(input.value)
    if (!Number.isFinite(line) || line < 1 || line > opts.maxLine) {
      input.focus()
      input.select()
      return
    }
    close()
    opts.onSubmit(line)
  }

  okBtn.addEventListener('click', submit)
  cancelBtn.addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })

  document.body.appendChild(overlay)
  input.focus()
  input.select()
}
