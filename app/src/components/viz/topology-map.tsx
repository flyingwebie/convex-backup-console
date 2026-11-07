import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { BreadcrumbTrail, EntityChip } from './entity-chip'
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

/** Below this container width (px) the map switches from the 3-column graph to a stacked,
 * single-column layout: grouped Instances → Jobs → Destinations sections with short connector
 * strips between them and per-node connection chips instead of measured SVG edges. */
const STACK_BREAKPOINT = 640

const EDGE_TO_DOT: Record<EdgeHealth, DotStatus> = {
  success: 'success',
  danger: 'danger',
  running: 'running',
  inactive: 'neutral',
}

/**
 * TopologyMap (DESIGN.md §5.2/§5.6) — the Overview page's visual anchor: Instances → Jobs →
 * Destinations laid out in three columns, with orthogonal SVG edges colored by the health of the
 * last run on that connection. Hovering a node highlights its connected edges and dims the rest.
 * Pure React + SVG, positions measured from the live NodeCard DOM via ResizeObserver (no graph
 * library) so it stays correct through font loading, column-count changes and window resizes.
 *
 * Below `STACK_BREAKPOINT` (tracked via the same ResizeObserver, so it works inside any narrow
 * container, not just a narrow viewport) it renders `StackedTopology` instead: a vertical stack of
 * grouped sections with short colored connector strips between them and per-node connection chips
 * (so the relationship survives even without the side-by-side columns). Tapping a node there
 * mirrors desktop hover — first tap highlights its path, a second tap on the already-highlighted
 * node navigates.
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
  const [stacked, setStacked] = useState(false)
  const allNodes = [...instances, ...jobs, ...destinations]

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      const base = container.getBoundingClientRect()
      setStacked(base.width < STACK_BREAKPOINT)
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

  if (stacked) {
    return (
      <div ref={containerRef} className={cn('relative w-full', className)}>
        <StackedTopology
          instances={instances}
          jobs={jobs}
          destinations={destinations}
          edges={edges}
          hovered={hovered}
          setHovered={setHovered}
        />
        {allNodes.length === 0 && <div className="text-muted-foreground p-6 text-sm">Nothing to show yet.</div>}
      </div>
    )
  }

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
        <Column label="Instances" nodes={instances} nodeRefs={nodeRefs} setHovered={setHovered} hovered={hovered} allEmpty={allNodes.length === 0} />
        <Column label="Jobs" nodes={jobs} nodeRefs={nodeRefs} setHovered={setHovered} hovered={hovered} allEmpty={allNodes.length === 0} />
        <Column label="Destinations" nodes={destinations} nodeRefs={nodeRefs} setHovered={setHovered} hovered={hovered} allEmpty={allNodes.length === 0} />
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
  allEmpty,
}: {
  label: string
  nodes: TopologyNode[]
  nodeRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  hovered: string | null
  setHovered: (id: string | null) => void
  /** The whole map (all three columns) is empty — the caller already shows one "Nothing to show
   * yet" message, so this column stays silent rather than piling on a second empty note. */
  allEmpty: boolean
}): ReactNode {
  if (nodes.length === 0) {
    if (allEmpty) return null
    return (
      <div className="flex flex-col gap-4">
        <div className="text-muted-foreground text-xs font-medium">{label} 0</div>
        <div className="border-border/60 text-muted-foreground flex h-[72px] w-[180px] shrink-0 items-center justify-center rounded-lg border border-dashed p-3 text-center text-xs">
          No {label.toLowerCase()} yet
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground text-xs font-medium">
        {label} <span className="font-mono">{nodes.length}</span>
      </div>
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

/**
 * Narrow-container layout (< `STACK_BREAKPOINT`): the same three groups stacked vertically instead
 * of side-by-side columns, since there's no room to measure and route orthogonal edges between
 * columns that no longer exist. Each inter-group gap gets a short colored `GroupConnector` strip
 * (one line per edge between the two groups, same health coloring/animation as the desktop SVG
 * edges) and every node gets its connections rendered inline as `EntityChip`s, so "what connects
 * to what" survives the loss of the side-by-side graph.
 */
function StackedTopology({
  instances,
  jobs,
  destinations,
  edges,
  hovered,
  setHovered,
}: {
  instances: TopologyNode[]
  jobs: TopologyNode[]
  destinations: TopologyNode[]
  edges: TopologyEdge[]
  hovered: string | null
  setHovered: (id: string | null) => void
}) {
  const byId = new Map(
    [...instances, ...jobs, ...destinations].map((n) => [n.id, n] as const),
  )
  const edgesBetween = (from: TopologyNode[], to: TopologyNode[]) => {
    const fromIds = new Set(from.map((n) => n.id))
    const toIds = new Set(to.map((n) => n.id))
    return edges.filter((e) => fromIds.has(e.from) && toIds.has(e.to))
  }

  return (
    // Tapping blank space between/around nodes clears the selection (mirrors mouse-leave on desktop).
    <div className="flex flex-col" onClick={() => setHovered(null)}>
      <StackedGroup label="Instances" nodes={instances} edges={edges} direction="out" byId={byId} hovered={hovered} setHovered={setHovered} emptyHint="Add an instance to start protecting it." />
      <GroupConnector edges={edgesBetween(instances, jobs)} hovered={hovered} />
      <StackedGroup label="Jobs" nodes={jobs} edges={edges} direction="both" byId={byId} hovered={hovered} setHovered={setHovered} emptyHint="No job is protecting any instance yet." />
      <GroupConnector edges={edgesBetween(jobs, destinations)} hovered={hovered} />
      <StackedGroup label="Destinations" nodes={destinations} edges={edges} direction="in" byId={byId} hovered={hovered} setHovered={setHovered} emptyHint="Add a destination to store backups in." />
    </div>
  )
}

function StackedGroup({
  label,
  nodes,
  edges,
  direction,
  byId,
  hovered,
  setHovered,
  emptyHint,
}: {
  label: string
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  /** Which side of each edge this group's chips should show: instances only show what they feed
   * ("out"), destinations only show what feeds them ("in"), jobs show both. */
  direction: 'in' | 'out' | 'both'
  byId: Map<string, TopologyNode>
  hovered: string | null
  setHovered: (id: string | null) => void
  emptyHint: string
}) {
  if (nodes.length === 0) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="text-muted-foreground text-xs font-medium">{label} 0</div>
        <div className="border-border/60 text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">{emptyHint}</div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="text-muted-foreground text-xs font-medium">
        {label} <span className="font-mono">{nodes.length}</span>
      </div>
      <div className="flex flex-col gap-3">
        {nodes.map((n) => (
          <StackedNode key={n.id} node={n} edges={edges} direction={direction} byId={byId} hovered={hovered} setHovered={setHovered} />
        ))}
      </div>
    </div>
  )
}

function StackedNode({
  node,
  edges,
  direction,
  byId,
  hovered,
  setHovered,
}: {
  node: TopologyNode
  edges: TopologyEdge[]
  direction: 'in' | 'out' | 'both'
  byId: Map<string, TopologyNode>
  hovered: string | null
  setHovered: (id: string | null) => void
}) {
  const selected = hovered === node.id
  const dimmed = hovered != null && !selected

  const outgoing = direction !== 'in' ? edges.filter((e) => e.from === node.id) : []
  const incoming = direction !== 'out' ? edges.filter((e) => e.to === node.id) : []
  const hasConnections = outgoing.length > 0 || incoming.length > 0

  return (
    <div
      className={cn('transition-opacity', dimmed && 'opacity-60')}
      // Capture-phase: on the first tap of an unselected node, swallow the click before NodeCard's
      // internal <Link> navigates, so it highlights the node's path instead (mirrors desktop
      // hover). Tapping the same, already-selected node a second time lets the Link through and
      // navigates — the node stays a real link, it just needs one extra tap on touch.
      onClickCapture={(e) => {
        if (!selected) {
          e.preventDefault()
          e.stopPropagation()
          setHovered(node.id)
        } else {
          e.stopPropagation()
        }
      }}
    >
      <NodeCard
        id={node.id}
        kind={node.kind}
        title={node.title}
        subtitle={node.subtitle}
        status={node.status}
        to={node.to}
        className={cn('w-full', selected && 'border-ring')}
      />
      {hasConnections ? (
        <BreadcrumbTrail className="mt-1.5 pl-1">
          {incoming.map((e) => {
            const from = byId.get(e.from)
            if (!from) return null
            return (
              <span key={`in-${e.from}`} className="flex items-center gap-1.5">
                <span aria-hidden className="text-muted-foreground text-xs">←</span>
                <EntityChip kind={from.kind} name={from.title} to={from.to} status={EDGE_TO_DOT[e.health]} size="sm" />
              </span>
            )
          })}
          {outgoing.map((e) => {
            const to = byId.get(e.to)
            if (!to) return null
            return (
              <span key={`out-${e.to}`} className="flex items-center gap-1.5">
                <span aria-hidden className="text-muted-foreground text-xs">→</span>
                <EntityChip kind={to.kind} name={to.title} to={to.to} status={EDGE_TO_DOT[e.health]} size="sm" />
              </span>
            )
          })}
        </BreadcrumbTrail>
      ) : (
        <p className="text-muted-foreground mt-1.5 pl-1 text-xs">No connections yet.</p>
      )}
    </div>
  )
}

/** A short strip of vertical, per-edge colored lines between two stacked groups — the stacked
 * layout's stand-in for the desktop orthogonal SVG edge (there's no second column to route a path
 * to), same health coloring, dashing and `edge-flow` running-animation as `TopologyMap`'s main SVG. */
function GroupConnector({ edges, hovered }: { edges: TopologyEdge[]; hovered: string | null }) {
  if (edges.length === 0) return null
  const n = edges.length
  return (
    <svg className="h-6 w-full shrink-0" width="100%" height={24} aria-hidden>
      {edges.map((edge, i) => {
        const x = `${((i + 1) / (n + 1)) * 100}%`
        const connected = hovered != null && (edge.from === hovered || edge.to === hovered)
        const dimmed = hovered != null && !connected
        return (
          <line
            key={`${edge.from}-${edge.to}-${i}`}
            x1={x}
            x2={x}
            y1={0}
            y2={24}
            stroke={EDGE_STROKE[edge.health]}
            strokeWidth={connected ? 2.5 : 1.5}
            strokeDasharray={edge.health === 'inactive' ? '4 3' : edge.health === 'running' ? '6 4' : undefined}
            opacity={dimmed ? 0.25 : edge.health === 'inactive' ? 0.4 : 1}
            className={edge.health === 'running' ? 'edge-flow' : undefined}
          />
        )
      })}
    </svg>
  )
}
