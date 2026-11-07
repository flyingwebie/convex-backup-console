import { cn } from '~/lib/utils'

/**
 * StatusDot — the atomic unit of the status vocabulary (DESIGN.md §5.3).
 *
 * An 8px filled circle colored from the semantic status tokens. `running` additionally renders a
 * pulsing outer ring (the one place sustained looped motion is allowed — it communicates "this is
 * happening right now"). Used standalone in table leftmost columns, inside NodeCard corners, and
 * inside Badges (dot + word) instead of a solid-fill badge background.
 *
 * ```tsx
 * <StatusDot status="running" />
 * <StatusDot status="danger" label="Failed" />           // sr-only label for a bare dot
 * <Badge variant="outline"><StatusDot status="success" className="mr-1" />Ok</Badge>
 * ```
 */
export type DotStatus = 'success' | 'warning' | 'danger' | 'running' | 'info' | 'neutral'

const DOT_COLOR: Record<DotStatus, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  running: 'bg-running',
  info: 'bg-info',
  neutral: 'bg-muted-foreground/50',
}

const RING_COLOR: Record<DotStatus, string> = {
  success: 'bg-success/40',
  warning: 'bg-warning/40',
  danger: 'bg-danger/40',
  running: 'bg-running/40',
  info: 'bg-info/40',
  neutral: 'bg-muted-foreground/30',
}

export function StatusDot({
  status,
  size = 'md',
  label,
  className,
}: {
  status: DotStatus
  /** sm = 6px (dense table rows), md = 8px (default, cards/badges). */
  size?: 'sm' | 'md'
  /** Accessible label when the dot stands alone with no adjacent text. */
  label?: string
  className?: string
}) {
  const dim = size === 'sm' ? 'size-1.5' : 'size-2'
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', dim, className)}>
      {status === 'running' && <span aria-hidden className={cn('status-dot-ring absolute inset-0 rounded-full', RING_COLOR[status])} />}
      <span aria-hidden className={cn('relative inline-block rounded-full', dim, DOT_COLOR[status])} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
