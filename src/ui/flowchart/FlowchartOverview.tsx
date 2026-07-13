import { useId, useMemo, type MouseEvent } from 'react'
import { useReactFlow, useStore, type Node } from '@xyflow/react'
import type { FlowchartNodeKind } from '../../ttl/flowchart'
import type { FlowNodeData } from './FlowNode'

const OVERVIEW_WIDTH = 84
const OVERVIEW_HEIGHT = 56
const OVERVIEW_PADDING = 6

function overviewNodeColor(kind: FlowchartNodeKind, dark: boolean): string {
  const colors: Record<FlowchartNodeKind, string> = dark
    ? {
        entry: '#5a9fd4',
        exit: '#e07070',
        process: '#707070',
        assignment: '#909090',
        decision: '#b08cff',
        loop: '#b08cff',
        io: '#45b8c4',
        dialog: '#45b8c4',
        jump: '#6a9fd8',
        include: '#d4b05c',
        terminal: '#e07070',
        warning: '#e07070',
      }
    : {
        entry: '#4a7ab8',
        exit: '#c44a4a',
        process: '#9a9690',
        assignment: '#7a7670',
        decision: '#8a6ab0',
        loop: '#8a6ab0',
        io: '#3d8f7a',
        dialog: '#3d8f7a',
        jump: '#4a7ab8',
        include: '#9a7d28',
        terminal: '#c44a4a',
        warning: '#c44a4a',
      }
  return colors[kind]
}

function graphBounds(nodes: Node<FlowNodeData>[]): { x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const width = node.width ?? node.measured?.width ?? 210
    const height = node.height ?? node.measured?.height ?? 68
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  }
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  return { x: minX, y: minY, width, height }
}

export function FlowchartOverview({
  nodes,
  dark,
  nodeWidth,
  nodeHeight,
}: {
  nodes: Node<FlowNodeData>[]
  dark: boolean
  nodeWidth: number
  nodeHeight: number
}) {
  const maskId = `flow-overview-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { setViewport } = useReactFlow()
  const transform = useStore((state) => state.transform)
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)

  const layout = useMemo(() => {
    const bounds = graphBounds(nodes)
    const innerWidth = OVERVIEW_WIDTH - OVERVIEW_PADDING * 2
    const innerHeight = OVERVIEW_HEIGHT - OVERVIEW_PADDING * 2
    const scale = Math.min(innerWidth / bounds.width, innerHeight / bounds.height)
    const offsetX = OVERVIEW_PADDING + (innerWidth - bounds.width * scale) / 2 - bounds.x * scale
    const offsetY = OVERVIEW_PADDING + (innerHeight - bounds.height * scale) / 2 - bounds.y * scale
    return { bounds, scale, offsetX, offsetY }
  }, [nodes])

  const viewportRect = useMemo(() => {
    const [, , zoom] = transform
    if (!paneWidth || !paneHeight || zoom <= 0) return null
    const x = -transform[0] / zoom
    const y = -transform[1] / zoom
    const width = paneWidth / zoom
    const height = paneHeight / zoom
    return {
      x: layout.offsetX + x * layout.scale,
      y: layout.offsetY + y * layout.scale,
      width: width * layout.scale,
      height: height * layout.scale,
    }
  }, [layout, paneHeight, paneWidth, transform])

  const bg = dark ? '#2a2a2a' : '#e8e6e2'
  const maskFill = dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(228, 226, 222, 0.72)'
  const maskStroke = dark ? '#b0b0b0' : '#6b6864'

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!paneWidth || !paneHeight) return
    const rect = event.currentTarget.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const flowX = (sx - layout.offsetX) / layout.scale
    const flowY = (sy - layout.offsetY) / layout.scale
    const [, , zoom] = transform
    void setViewport({
      x: paneWidth / 2 - flowX * zoom,
      y: paneHeight / 2 - flowY * zoom,
      zoom,
    })
  }

  return (
    <svg
      className="flowchart-overview"
      width={OVERVIEW_WIDTH}
      height={OVERVIEW_HEIGHT}
      viewBox={`0 0 ${OVERVIEW_WIDTH} ${OVERVIEW_HEIGHT}`}
      aria-label="フローチャート概要"
      onClick={handleClick}
    >
      <defs>
        {viewportRect ? (
          <mask id={maskId}>
            <rect x={0} y={0} width={OVERVIEW_WIDTH} height={OVERVIEW_HEIGHT} fill="white" />
            <rect
              x={viewportRect.x}
              y={viewportRect.y}
              width={viewportRect.width}
              height={viewportRect.height}
              fill="black"
            />
          </mask>
        ) : null}
      </defs>
      <rect x={0} y={0} width={OVERVIEW_WIDTH} height={OVERVIEW_HEIGHT} fill={bg} rx={4} />
      {nodes.map((node) => {
        const kind = node.data.model.kind as FlowchartNodeKind
        const width = node.width ?? nodeWidth
        const height = node.height ?? nodeHeight
        return (
          <rect
            key={node.id}
            x={layout.offsetX + node.position.x * layout.scale}
            y={layout.offsetY + node.position.y * layout.scale}
            width={Math.max(width * layout.scale, 1.5)}
            height={Math.max(height * layout.scale, 1.5)}
            rx={2}
            fill={overviewNodeColor(kind, dark)}
            stroke={dark ? '#1e1e1e' : '#b8b4ad'}
            strokeWidth={0.5}
          />
        )
      })}
      {viewportRect ? (
        <>
          <rect
            x={0}
            y={0}
            width={OVERVIEW_WIDTH}
            height={OVERVIEW_HEIGHT}
            fill={maskFill}
            mask={`url(#${maskId})`}
          />
          <rect
            x={viewportRect.x}
            y={viewportRect.y}
            width={viewportRect.width}
            height={viewportRect.height}
            fill="none"
            stroke={maskStroke}
            strokeWidth={1}
          />
        </>
      ) : null}
    </svg>
  )
}
