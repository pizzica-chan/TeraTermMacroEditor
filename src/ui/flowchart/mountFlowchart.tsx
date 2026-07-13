import { createRoot, type Root } from 'react-dom/client'
import type { FlowchartModel } from '../../ttl/flowchart'
import { FlowchartView } from './FlowchartView'

export interface FlowchartMount {
  update(model: FlowchartModel | null): void
  setActiveLocation(location: string | undefined): void
  setTheme(dark: boolean): void
  setVisible(visible: boolean): void
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
  let visible = false

  const render = () => {
    root.render(
      <FlowchartView
        model={model}
        activeLocation={activeLocation}
        dark={dark}
        visible={visible}
        onGotoLocation={options.onGotoLocation}
      />,
    )
  }

  render()
  return {
    update(nextModel) {
      model = nextModel
      if (visible) render()
    },
    setActiveLocation(location) {
      if (activeLocation === location) return
      activeLocation = location
      if (visible) render()
    },
    setTheme(nextDark) {
      if (dark === nextDark) return
      dark = nextDark
      render()
    },
    setVisible(nextVisible) {
      if (visible === nextVisible) return
      visible = nextVisible
      render()
    },
    destroy() {
      root.unmount()
    },
  }
}
