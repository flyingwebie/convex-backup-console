import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '~/lib/utils'
import { ENTITY_ICON, type EntityKind } from './entity-kind'
import { StatusDot, type DotStatus } from './status-dot'

/**
 * EntityChip (Linked-Entity Chip, DESIGN.md §5.5) — a small pill: kind icon + name, optionally a
 * trailing mono fragment (e.g. a destination chip rendered `R2 · prod-eu-backups`). Renders as a
 * `Link` when given `to`, otherwise a static span. Used as breadcrumbs ("Run 4f82 ← Job
 * nightly-prod ← Instance prod-eu") and inside tables when a cell references another entity
 * instead of just naming it in plain text.
 *
 * ```tsx
 * <EntityChip kind="destination" name="prod-eu-backups" meta="R2" to="/destinations" size="sm" />
 * <EntityChip kind="job" name="nightly-prod" to="/jobs" status="running" size="md" />
 * ```
 */
export function EntityChip({
  kind,
  name,
  meta,
  to,
  search,
  status,
  size = 'md',
  className,
}: {
  kind: EntityKind
  name: string
  /** Trailing mono fragment, e.g. a bucket/region fragment or short id. */
  meta?: string
  /** When set, the chip navigates here (TanStack Link). */
  to?: string
  /** Optional search params merged into the `Link` when `to` is set — e.g. `entityHref(kind, id).search`
   * (`{ focus: id }`) to deep-link straight to this entity's row on its list page instead of just the
   * bare list. Ignored when `to` is omitted. */
  search?: Record<string, string>
  /** Optional status dot, e.g. an instance's reachability or a job's last-run health. */
  status?: DotStatus
  /** sm = inline in table cells/log lines, md = breadcrumb trail, lg = unused standalone size (see NodeCard for the lg lineage case). */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const Icon = ENTITY_ICON[kind]
  const sizeCls =
    size === 'sm' ? 'h-6 gap-1 px-1.5 text-xs' : size === 'lg' ? 'h-9 gap-2 px-3 text-sm' : 'h-7 gap-1.5 px-2 text-xs'
  const iconCls = size === 'lg' ? 'size-4' : 'size-3.5'

  const content = (
    <>
      {status && <StatusDot status={status} size="sm" />}
      <Icon className={cn(iconCls, 'shrink-0 opacity-70')} />
      <span className="truncate font-medium">{name}</span>
      {meta && <span className="font-mono text-muted-foreground truncate">· {meta}</span>}
    </>
  )

  const cls = cn(
    'inline-flex max-w-[16rem] items-center rounded-full border border-border bg-card',
    sizeCls,
    to && 'transition-colors hover:border-ring hover:bg-accent',
    className,
  )

  if (to) {
    return (
      <Link to={to} search={search as never} className={cls}>
        {content}
      </Link>
    )
  }
  return <span className={cls}>{content}</span>
}

/**
 * BreadcrumbTrail — a row of EntityChips joined by a quiet arrow separator, for "Run ← Job ←
 * Instance" style breadcrumbs (DESIGN.md §4.4, §5.5).
 */
export function BreadcrumbTrail({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-1.5', className)}>{children}</div>
}
