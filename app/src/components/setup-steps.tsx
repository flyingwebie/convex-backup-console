import { Check } from 'lucide-react'
import { cn } from '~/lib/utils'

export const SETUP_STEPS = [
  { key: 'account', label: 'Account' },
  { key: 'security', label: 'Two-factor' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'team', label: 'Team' },
] as const
export type SetupStepKey = (typeof SETUP_STEPS)[number]['key']

/** Progress of the first-run wizard. */
export function SetupSteps({ current }: { current: SetupStepKey }) {
  const at = SETUP_STEPS.findIndex((s) => s.key === current)
  return (
    <ol className="flex w-full max-w-xl items-center gap-2" aria-label="Setup progress">
      {SETUP_STEPS.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-2" aria-current={i === at ? 'step' : undefined}>
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
              i < at && 'bg-primary border-primary text-primary-foreground',
              i === at && 'border-primary text-primary',
              i > at && 'text-muted-foreground',
            )}
          >
            {i < at ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn('text-sm', i === at ? 'font-medium' : 'text-muted-foreground', 'hidden sm:inline')}>{s.label}</span>
          {i < SETUP_STEPS.length - 1 && <span className={cn('h-px flex-1', i < at ? 'bg-primary' : 'bg-border')} />}
        </li>
      ))}
    </ol>
  )
}
