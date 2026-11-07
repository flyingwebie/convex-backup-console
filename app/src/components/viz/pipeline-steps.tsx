import type { ReactNode } from 'react'
import { Check, Loader2, Minus, RotateCcw, X } from 'lucide-react'
import { cn } from '~/lib/utils'

/**
 * PipelineStep (DESIGN.md §5.4) — the CI-pipeline-style step vocabulary shared by three screens:
 * the backup run pipeline (export → compress → encrypt → upload×N → verify), the restore
 * pipeline, and the bucket-provisioning wizard's live progress. Same component, three contexts —
 * operators learn the shape once.
 */
export type PipelineStepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped' | 'rolled_back'

export type PipelineStepItem = {
  id: string
  label: string
  status: PipelineStepStatus
  /** Secondary line: error detail, a timestamp, or a byte count. Mono by convention if it's a fact. */
  detail?: string
  /** Shown only when status is "failed" — scoped retry for just this step. */
  onRetry?: () => void
}

const ICON: Record<PipelineStepStatus, ReactNode> = {
  pending: <span aria-hidden className="block size-2 rounded-full border border-muted-foreground/50" />,
  active: <Loader2 className="size-3.5 animate-spin text-running" />,
  done: <Check className="size-3.5 text-success" />,
  failed: <X className="size-3.5 text-danger" />,
  skipped: <Minus className="size-3.5 text-muted-foreground" />,
  rolled_back: <RotateCcw className="size-3.5 text-warning" />,
}

const CHIP_BG: Record<PipelineStepStatus, string> = {
  pending: 'border border-border border-dashed bg-transparent text-muted-foreground',
  active: 'bg-running-muted text-foreground font-medium',
  done: 'bg-success-muted text-foreground',
  failed: 'bg-danger-muted text-foreground cursor-pointer',
  skipped: 'border border-border border-dashed bg-transparent text-muted-foreground opacity-70',
  rolled_back: 'bg-warning-muted text-foreground',
}

/**
 * ```tsx
 * // Horizontal strip, e.g. collapsed inside a run row (DESIGN.md: "collapsed to dots, expandable
 * // to the full strip"):
 * <PipelineSteps orientation="horizontal" steps={runSteps} />
 *
 * // Vertical — also the shape used by the provisioning wizard's live progress log:
 * <PipelineSteps orientation="vertical" steps={provisionSteps} />
 * ```
 */
export function PipelineSteps({
  steps,
  orientation = 'horizontal',
  compact = false,
  className,
}: {
  steps: PipelineStepItem[]
  orientation?: 'horizontal' | 'vertical'
  /** Collapse to bare status dots with a connector line — no labels. Expand on click/hover elsewhere. */
  compact?: boolean
  className?: string
}) {
  if (orientation === 'vertical') return <VerticalSteps steps={steps} className={className} />
  return (
    <div className={cn('flex items-center', className)}>
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center">
          {compact ? (
            <span title={`${step.label}: ${step.status}`} className="flex items-center justify-center">
              {step.status === 'pending' || step.status === 'skipped' ? (
                <span className={cn('block size-1.5 rounded-full', step.status === 'skipped' ? 'bg-muted-foreground/40' : 'bg-muted-foreground/25')} />
              ) : (
                ICON[step.status]
              )}
            </span>
          ) : (
            <button
              type="button"
              disabled={step.status !== 'failed' || !step.onRetry}
              onClick={step.onRetry}
              className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap', CHIP_BG[step.status])}
            >
              {ICON[step.status]}
              {step.label}
            </button>
          )}
          {i < steps.length - 1 && <div aria-hidden className="bg-border mx-1 h-px w-3 shrink-0" />}
        </div>
      ))}
    </div>
  )
}

function VerticalSteps({ steps, className }: { steps: PipelineStepItem[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => (
        <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className="bg-border absolute top-5 left-[9px] -ml-px h-full w-px" />}
          <span
            className={cn(
              'z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full',
              step.status === 'pending' || step.status === 'skipped' ? 'border border-border bg-background' : 'bg-card',
            )}
          >
            {ICON[step.status]}
          </span>
          <div className="min-w-0 flex-1 pt-px">
            <div className={cn('text-sm', step.status === 'failed' ? 'font-medium text-danger' : step.status === 'active' ? 'font-medium' : 'text-foreground', step.status === 'skipped' && 'text-muted-foreground')}>
              {step.label}
            </div>
            {step.detail && <div className="text-muted-foreground mt-0.5 font-mono text-xs">{step.detail}</div>}
            {step.status === 'failed' && step.onRetry && (
              <button type="button" onClick={step.onRetry} className="text-danger mt-1 text-xs font-medium underline-offset-2 hover:underline">
                Retry this step
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
