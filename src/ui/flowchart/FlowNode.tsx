import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { FlowchartNode } from '../../ttl/flowchart'

export interface FlowNodeData extends Record<string, unknown> {
  label: string
  model: FlowchartNode
}

export function FlowNode({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <>
      <div className="flowchart-node-label">{data.label}</div>
      <Handle className="flowchart-handle" type="target" position={Position.Top} />
      <Handle className="flowchart-handle" type="source" position={Position.Bottom} />
    </>
  )
}
