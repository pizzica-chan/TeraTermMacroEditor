import { createRoot, type Root } from 'react-dom/client'
import type { FlowchartModel } from '../../ttl/flowchart'
import { FlowchartView } from './FlowchartView'

export interface FlowchartMount {
  update(model: FlowchartModel | null): void
  setActiveLocation(location: string | undefined): void
  setTheme(dark: boolean): void
  refresh(): void
  destroy(): void
}

export function mountFlowchart(
  container: HTMLElement,
  options: {
    dark: boolean
    onGotoLocation: (location: string) => void
  },
): FlowchartMount {
  const root: Root = createRoot(container)
  let model: FlowchartModel | null = null
  let activeLocation: string | undefined
  let dark = options.dark
  let revision = 0

  const render = () => {
    root.render(
      <FlowchartView
        key={revision}
        model={model}
        activeLocation={activeLocation}
        dark={dark}
        onGotoLocation={options.onGotoLocation}
      />,
    )
  }

  render()
  return {
    update(nextModel) {
      model = nextModel
      revision++
      render()
    },
    setActiveLocation(location) {
      if (activeLocation === location) return
      activeLocation = location
      render()
    },
    setTheme(nextDark) {
      if (dark === nextDark) return
      dark = nextDark
      render()
    },
    refresh() {
      revision++
      render()
    },
    destroy() {
      root.unmount()
    },
  }
}
