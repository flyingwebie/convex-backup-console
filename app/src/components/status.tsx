import { CheckCircle2, CircleAlert, CircleX, Loader2, PauseCircle } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'

const styles = {
  ok: { label: 'Success', icon: CheckCircle2, cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  partial: { label: 'Partial', icon: CircleAlert, cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  failed: { label: 'Failed', icon: CircleX, cls: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400' },
  running: { label: 'Running', icon: Loader2, cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  paused: { label: 'Paused', icon: PauseCircle, cls: 'border-muted-foreground/30 text-muted-foreground' },
} as const

export type Status = keyof typeof styles

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = styles[status as Status] ?? styles.paused
  const Icon = s.icon
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', s.cls)}>
      <Icon className={cn('size-3', status === 'running' && 'animate-spin')} />
      {label ?? s.label}
    </Badge>
  )
}
