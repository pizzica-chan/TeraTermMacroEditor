import type { FlowchartNode } from '../../ttl/flowchart'

export function matchesFlowchartActiveLocation(
  node: Pick<FlowchartNode, 'line' | 'endLine' | 'sourceId' | 'sourceName'>,
  activeLocation?: string,
): boolean {
  const activeMatch = /^(.*):L(\d+)$/.exec(activeLocation ?? '')
  if (!activeMatch) return false
  const activePrefix = activeMatch[1]!.replace(/\\/g, '/').toLowerCase()
  const sourceName = node.sourceName.replace(/\\/g, '/').toLowerCase()
  const activeLine = Number(activeMatch[2])
  return (
    activeLine >= node.line &&
    activeLine <= node.endLine &&
    (activePrefix === node.sourceId.toLowerCase() ||
      activePrefix === sourceName ||
      sourceName.endsWith(`/${activePrefix}`) ||
      activePrefix.endsWith(`/${sourceName}`))
  )
}

export function reachableNodeIds(
  nodes: Array<{ id: string; kind: string }>,
  edges: Array<{ source: string; target: string }>,
): Set<string> {
  const entry = nodes.find((node) => node.kind === 'entry')
  if (!entry) return new Set()
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge.target)
    outgoing.set(edge.source, list)
  }
  const seen = new Set<string>()
  const queue = [entry.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const target of outgoing.get(id) ?? []) queue.push(target)
  }
  return seen
}
