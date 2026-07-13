import { useMemo } from 'react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  FlowchartEdge,
  FlowchartModel,
  FlowchartNode,
  FlowchartNodeKind,
} from '../../ttl/flowchart'

export interface FlowchartViewProps {
  model: FlowchartModel | null
  activeLocation?: string
  dark: boolean
  onGotoLocation: (location: string) => void
}

interface FlowNodeData extends Record<string, unknown> {
  label: string
  model: FlowchartNode
}

const NODE_WIDTH = 210
const NODE_HEIGHT = 68

function edgeColor(kind: FlowchartEdge['kind']): string {
  if (kind === 'true' || kind === 'include' || kind === 'call') return 'var(--flow-edge-positive)'
  if (kind === 'false' || kind === 'return') return 'var(--flow-edge-negative)'
  if (kind === 'jump' || kind === 'loop') return 'var(--flow-edge-accent)'
  return 'var(--flow-edge-default)'
}

function layoutModel(model: FlowchartModel, activeLocation?: string): {
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
} {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'TB',
    ranksep: 72,
    nodesep: 34,
    edgesep: 18,
    marginx: 24,
    marginy: 24,
  })

  for (const node of model.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of model.edges) graph.setEdge(edge.source, edge.target)
  dagre.layout(graph)

  const nodes: Node<FlowNodeData>[] = model.nodes.map((node) => {
    const point = graph.node(node.id) as { x: number; y: number }
    const activeMatch = /^(.*):L(\d+)$/.exec(activeLocation ?? '')
    const activePrefix = activeMatch?.[1]?.replace(/\\/g, '/').toLowerCase()
    const sourceName = node.sourceName.replace(/\\/g, '/').toLowerCase()
    const activeLine = Number(activeMatch?.[2] ?? 0)
    const isActive =
      activeLine >= node.line &&
      activeLine <= node.endLine &&
      (activePrefix === node.sourceId.toLowerCase() ||
        activePrefix === sourceName ||
        sourceName.endsWith(`/${activePrefix}`) ||
        activePrefix?.endsWith(`/${sourceName}`))
    return {
      id: node.id,
      position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
      data: { label: node.label, model: node },
      className: `flowchart-node flowchart-node-${node.kind}${isActive ? ' flowchart-node-active' : ''}`,
      style: { width: NODE_WIDTH, minHeight: NODE_HEIGHT },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  })

  const edges: Edge[] = model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: edge.kind === 'jump' || edge.kind === 'return' ? 'smoothstep' : 'default',
    animated: edge.kind === 'loop' || edge.kind === 'call' || edge.kind === 'include',
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(edge.kind) },
    style: { stroke: edgeColor(edge.kind), strokeWidth: edge.kind === 'flow' ? 1.4 : 1.8 },
    labelStyle: { fill: 'var(--text-secondary)', fontSize: 11 },
    labelBgStyle: { fill: 'var(--bg-secondary)', fillOpacity: 0.9 },
  }))

  return { nodes, edges }
}

function minimapNodeColor(kind: FlowchartNodeKind, dark: boolean): string {
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

function minimapTheme(dark: boolean) {
  return dark
    ? {
        bgColor: '#2a2a2a',
        maskColor: 'rgba(0, 0, 0, 0.55)',
        maskStrokeColor: '#858585',
        nodeStrokeColor: '#1e1e1e',
      }
    : {
        bgColor: '#e8e6e2',
        maskColor: 'rgba(228, 226, 222, 0.72)',
        maskStrokeColor: '#6b6864',
        nodeStrokeColor: '#b8b4ad',
      }
}

export function FlowchartView({
  model,
  activeLocation,
  dark,
  onGotoLocation,
}: FlowchartViewProps) {
  const layout = useMemo(
    () => (model ? layoutModel(model, activeLocation) : { nodes: [], edges: [] }),
    [model, activeLocation],
  )
  const miniMapTheme = useMemo(() => minimapTheme(dark), [dark])

  if (!model || model.nodes.length === 0) {
    return <div className="flowchart-empty">表示できる処理がありません</div>
  }

  return (
    <ReactFlow
      nodes={layout.nodes}
      edges={layout.edges}
      colorMode={dark ? 'dark' : 'light'}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
      minZoom={0.15}
      maxZoom={1.8}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_, node) => onGotoLocation((node.data as FlowNodeData).model.location)}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <MiniMap
        pannable
        zoomable
        style={{ width: 84, height: 56 }}
        bgColor={miniMapTheme.bgColor}
        maskColor={miniMapTheme.maskColor}
        maskStrokeColor={miniMapTheme.maskStrokeColor}
        maskStrokeWidth={1}
        nodeBorderRadius={3}
        nodeStrokeWidth={1}
        nodeStrokeColor={miniMapTheme.nodeStrokeColor}
        nodeColor={(node) => minimapNodeColor((node.data as FlowNodeData).model.kind, dark)}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
