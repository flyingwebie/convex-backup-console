import { forwardRef } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '~/lib/utils'
import { ENTITY_ICON, ENTITY_TINT, type EntityKind } from './entity-kind'
import { StatusDot, type DotStatus } from './status-dot'

/**
 * NodeCard (DESIGN.md §5.1) — a small, fixed-size (~180×72px) card representing one entity inside
 * a diagram (TopologyMap, restore lineage view). Entity-kind icon in a tinted square, entity name
 * (truncated), one secondary mono line (URL host, bucket/region, or "3 jobs"), and a StatusDot in
 * the top-right corner. 1px border at rest, `--ring` on hover; links to the entity's page via an
 * absolutely-positioned overlay anchor so the outer `div` (and its ref) stays the stable
 * measurement box a diagram's ResizeObserver reads.
 *
 * Forwards its ref so a measuring parent (TopologyMap) can read this node's DOM rect for drawing
 * edges — pass `id` too so the parent can key off it (`data-node-id`).
 *
 * ```tsx
 * <NodeCard kind="destination" title="prod-eu-backups" subtitle="r2 · eu" status="success" to="/destinations" />
 *
 * // Lineage pair (NodeCard + Edge in a straight 2-node line, DESIGN.md §5.5 "lg" chip case):
 * <div className="flex items-center gap-3">
 *   <NodeCard kind="run" title="Backup 4f82" subtitle="2026-11-05 03:00" to="/runs" />
 *   <ArrowRight className="text-muted-foreground shrink-0" />
 *   <NodeCard kind="instance" title="prod-eu" subtitle="prod-eu.example.com" to="/instances" />
 * </div>
 * ```
 */
export const NodeCard = forwardRef<
  HTMLDivElement,
  {
    kind: EntityKind
    title: string
    subtitle?: string
    status?: DotStatus
    to?: string
    id?: string
    className?: string
  }
>(function NodeCard({ kind, title, subtitle, status, to, id, className }, ref) {
  const Icon = ENTITY_ICON[kind]
  const tint = ENTITY_TINT[kind]

  return (
    <div
      ref={ref}
      id={id}
      data-node-id={id}
      className={cn(
        'relative flex h-[72px] w-[180px] shrink-0 items-center gap-2.5 rounded-lg border border-border bg-card p-3',
        to && 'transition-colors hover:border-ring',
        className,
      )}
    >
      {to && (
        <Link to={to} className="absolute inset-0 rounded-lg" aria-label={title}>
          <span className="sr-only">{title}</span>
        </Link>
      )}
      {status && <StatusDot status={status} className="absolute top-2 right-2" />}
      <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', tint.bg, tint.fg)}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="text-muted-foreground truncate font-mono text-xs">{subtitle}</div>}
      </div>
    </div>
  )
})
