import { useMemo } from 'react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  FlowchartEdge,
  FlowchartModel,
} from '../../ttl/flowchart'
import { FlowNode, type FlowNodeData } from './FlowNode'
import { FlowchartOverview } from './FlowchartOverview'
import { matchesFlowchartActiveLocation } from './flowchartUtils'

export interface FlowchartViewProps {
  model: FlowchartModel | null
  activeLocation?: string
  dark: boolean
  visible: boolean
  onGotoLocation: (location: string) => void
}

const NODE_WIDTH = 210
const NODE_HEIGHT = 68
const nodeTypes = { flow: FlowNode } satisfies NodeTypes

function edgeColor(kind: FlowchartEdge['kind']): string {
  if (kind === 'true' || kind === 'include' || kind === 'call') return 'var(--flow-edge-positive)'
  if (kind === 'false' || kind === 'return') return 'var(--flow-edge-negative)'
  if (kind === 'jump' || kind === 'loop') return 'var(--flow-edge-accent)'
  return 'var(--flow-edge-default)'
}

function layoutModel(model: FlowchartModel): {
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

  const nodeIds = new Set(model.nodes.map((node) => node.id))
  for (const node of model.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of model.edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      graph.setEdge(edge.source, edge.target)
    }
  }
  dagre.layout(graph)

  const nodes: Node<FlowNodeData>[] = model.nodes.map((node, index) => {
    const point = graph.node(node.id) as { x?: number; y?: number } | undefined
    const centerX: number = Number.isFinite(point?.x) ? point!.x! : index * (NODE_WIDTH + 40)
    const centerY: number = Number.isFinite(point?.y) ? point!.y! : index * (NODE_HEIGHT + 48)
    return {
      id: node.id,
      type: 'flow',
      position: { x: centerX - NODE_WIDTH / 2, y: centerY - NODE_HEIGHT / 2 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      data: { label: node.label, model: node },
      className: `flowchart-node flowchart-node-${node.kind}`,
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
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

function applyActiveHighlight(
  nodes: Node<FlowNodeData>[],
  activeLocation?: string,
): Node<FlowNodeData>[] {
  return nodes.map((node) => {
    const modelNode = node.data.model
    const isActive = activeLocation ? matchesFlowchartActiveLocation(modelNode, activeLocation) : false
    const baseClass = `flowchart-node flowchart-node-${modelNode.kind}`
    return {
      ...node,
      className: `${baseClass}${isActive ? ' flowchart-node-active' : ''}`,
    }
  })
}

export function FlowchartView({
  model,
  activeLocation,
  dark,
  visible,
  onGotoLocation,
}: FlowchartViewProps) {
  const baseLayout = useMemo(
    () => (model ? layoutModel(model) : { nodes: [], edges: [] }),
    [model],
  )
  const nodes = useMemo(
    () => applyActiveHighlight(baseLayout.nodes, activeLocation),
    [baseLayout.nodes, activeLocation],
  )
  const layout = useMemo(() => ({ nodes, edges: baseLayout.edges }), [nodes, baseLayout.edges])

  if (!visible) {
    return <div className="flowchart-empty">フロータブを開くと表示されます</div>
  }

  if (!model || model.nodes.length === 0) {
    return <div className="flowchart-empty">表示できる処理がありません</div>
  }

  return (
    <ReactFlow
      key={model.rootSourceId}
      nodes={layout.nodes}
      edges={layout.edges}
      nodeTypes={nodeTypes}
      colorMode={dark ? 'dark' : 'light'}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
      minZoom={0.15}
      maxZoom={1.8}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_, node) => onGotoLocation((node.data as FlowNodeData).model.location)}
      onNodesChange={() => {}}
      onEdgesChange={() => {}}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <Panel position="bottom-right" className="flowchart-overview-panel">
        <FlowchartOverview
          nodes={baseLayout.nodes}
          dark={dark}
          nodeWidth={NODE_WIDTH}
          nodeHeight={NODE_HEIGHT}
        />
      </Panel>
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
