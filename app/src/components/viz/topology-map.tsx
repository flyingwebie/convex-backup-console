import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '~/lib/utils'
import type { EntityKind } from './entity-kind'
import { NodeCard } from './node-card'
import type { DotStatus } from './status-dot'

export type TopologyNode = {
  id: string
  kind: EntityKind
  title: string
  subtitle?: string
  status?: DotStatus
  to?: string
}

export type EdgeHealth = 'success' | 'danger' | 'running' | 'inactive'

export type TopologyEdge = {
  from: string
  to: string
  health: EdgeHealth
  /** Small inline label, e.g. "last run 2h ago" or "every 6h". */
  label?: string
}

const EDGE_STROKE: Record<EdgeHealth, string> = {
  success: 'var(--success)',
  danger: 'var(--danger)',
  running: 'var(--running)',
  inactive: 'var(--muted-foreground)',
}

type Rect = { top: number; left: number; width: number; height: number }

/**
 * TopologyMap (DESIGN.md §5.2/§5.6) — the Overview page's visual anchor: Instances → Jobs →
 * Destinations laid out in three columns, with orthogonal SVG edges colored by the health of the
 * last run on that connection. Hovering a node highlights its connected edges and dims the rest.
 * Pure React + SVG, positions measured from the live NodeCard DOM via ResizeObserver (no graph
 * library) so it stays correct through font loading, column-count changes and window resizes.
 *
 * ```tsx
 * <TopologyMap
 *   instances={[{ id: 'i1', kind: 'instance', title: 'prod-eu', subtitle: 'prod-eu.example.com', status: 'success', to: '/instances' }]}
 *   jobs={[{ id: 'j1', kind: 'job', title: 'nightly-prod', subtitle: 'every 6h', status: 'running', to: '/jobs' }]}
 *   destinations={[{ id: 'd1', kind: 'destination', title: 'prod-eu-backups', subtitle: 'r2 · eu', status: 'success', to: '/destinations' }]}
 *   edges={[
 *     { from: 'i1', to: 'j1', health: 'running' },
 *     { from: 'j1', to: 'd1', health: 'success', label: 'last run 2h ago' },
 *   ]}
 * />
 * ```
 */
export function TopologyMap({
  instances,
  jobs,
  destinations,
  edges,
  className,
}: {
  instances: TopologyNode[]
  jobs: TopologyNode[]
  destinations: TopologyNode[]
  edges: TopologyEdge[]
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const [hovered, setHovered] = useState<string | null>(null)
  const allNodes = [...instances, ...jobs, ...destinations]

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      const base = container.getBoundingClientRect()
      const next: Record<string, Rect> = {}
      for (const [id, el] of nodeRefs.current) {
        const r = el.getBoundingClientRect()
        next[id] = { top: r.top - base.top, left: r.left - base.left, width: r.width, height: r.height }
      }
      setRects(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    for (const el of nodeRefs.current.values()) ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances.length, jobs.length, destinations.length, edges.length])

  const isConnected = (edge: TopologyEdge) => hovered != null && (edge.from === hovered || edge.to === hovered)
  const anyHover = hovered != null

  return (
    <div ref={containerRef} className={cn('relative w-full overflow-x-auto', className)}>
      {/* functional depth wash — the one decorative-looking gradient this system allows, because it's
          literally the canvas behind the graph, not a decorative page background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-lg"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, var(--accent), transparent 70%)' }}
      />
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {edges.map((edge, i) => {
          const from = rects[edge.from]
          const to = rects[edge.to]
          if (!from || !to) return null
          const x1 = from.left + from.width
          const y1 = from.top + from.height / 2
          const x2 = to.left
          const y2 = to.top + to.height / 2
          const midX = x1 + (x2 - x1) / 2
          const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`
          const dimmed = anyHover && !isConnected(edge)
          return (
            <g key={`${edge.from}-${edge.to}-${i}`} opacity={dimmed ? 0.25 : 1}>
              <path
                d={d}
                fill="none"
                stroke={EDGE_STROKE[edge.health]}
                strokeWidth={isConnected(edge) ? 2 : 1.5}
                strokeDasharray={edge.health === 'inactive' ? '4 3' : edge.health === 'running' ? '6 4' : undefined}
                opacity={edge.health === 'inactive' ? 0.4 : 1}
                className={edge.health === 'running' ? 'edge-flow' : undefined}
              />
              {edge.label && (
                <g transform={`translate(${midX}, ${(y1 + y2) / 2})`}>
                  <rect x={-1} y={-8} width={edge.label.length * 5.4 + 8} height={16} rx={4} fill="var(--background)" stroke="var(--border)" />
                  <text x={3} y={3} className="font-mono" fontSize={10} fill="var(--muted-foreground)">
                    {edge.label}
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>

      <div className="relative z-10 flex gap-10 p-2">
        <Column label="Instances" nodes={instances} nodeRefs={nodeRefs} setHovered={setHovered} hovered={hovered} />
        <Column label="Jobs" nodes={jobs} nodeRefs={nodeRefs} setHovered={setHovered} hovered={hovered} />
        <Column label="Destinations" nodes={destinations} nodeRefs={nodeRefs} setHovered={setHovered} hovered={hovered} />
      </div>
      {allNodes.length === 0 && <div className="text-muted-foreground relative z-10 p-6 text-sm">Nothing to show yet.</div>}
    </div>
  )
}

function Column({
  label,
  nodes,
  nodeRefs,
  hovered,
  setHovered,
}: {
  label: string
  nodes: TopologyNode[]
  nodeRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  hovered: string | null
  setHovered: (id: string | null) => void
}): ReactNode {
  if (nodes.length === 0) return null
  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className="flex flex-col gap-6">
        {nodes.map((n) => (
          <div
            key={n.id}
            ref={(el) => {
              if (el) nodeRefs.current.set(n.id, el)
              else nodeRefs.current.delete(n.id)
            }}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(null)}
            className={cn('transition-opacity', hovered && hovered !== n.id && 'opacity-60')}
          >
            <NodeCard id={n.id} kind={n.kind} title={n.title} subtitle={n.subtitle} status={n.status} to={n.to} />
          </div>
        ))}
      </div>
    </div>
  )
}
