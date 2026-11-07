import { Activity, Database, HardDrive, CalendarClock, type LucideIcon } from 'lucide-react'

/**
 * Shared entity-kind → icon/tint mapping used by EntityChip and NodeCard so instances, jobs,
 * destinations and runs always get the same color coding everywhere they appear (topology map,
 * Trash icons, breadcrumb chips — DESIGN.md §5.1/§5.5).
 */
export type EntityKind = 'instance' | 'job' | 'destination' | 'run'

export const ENTITY_ICON: Record<EntityKind, LucideIcon> = {
  instance: Database,
  job: CalendarClock,
  destination: HardDrive,
  run: Activity,
}

/** Tailwind classes for the tinted icon tile: instances=indigo (chart-1), jobs=violet (chart-5),
 * destinations=teal (chart-2), runs=rose (chart-4). */
export const ENTITY_TINT: Record<EntityKind, { bg: string; fg: string }> = {
  instance: { bg: 'bg-chart-1/15', fg: 'text-chart-1' },
  job: { bg: 'bg-chart-5/15', fg: 'text-chart-5' },
  destination: { bg: 'bg-chart-2/15', fg: 'text-chart-2' },
  run: { bg: 'bg-chart-4/15', fg: 'text-chart-4' },
}
