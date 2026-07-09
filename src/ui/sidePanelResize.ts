import { saveAppSettings } from '../storage/appSettings'

const MIN_WIDTH = 200
const MAX_WIDTH = 600

export function setupSidePanelResize(resizer: HTMLElement, sidePane: HTMLElement, initialWidth: number): void {
  sidePane.style.width = `${initialWidth}px`

  let dragging = false
  let startX = 0
  let startWidth = initialWidth

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault()
    dragging = true
    startX = e.clientX
    startWidth = sidePane.getBoundingClientRect().width
    resizer.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  })

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return
    const delta = startX - e.clientX
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta))
    sidePane.style.width = `${width}px`
  })

  document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    resizer.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    saveAppSettings({ sidePanelWidth: Math.round(sidePane.getBoundingClientRect().width) })
  })
}
