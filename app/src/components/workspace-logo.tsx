import { cn } from '~/lib/utils'

export function WorkspaceLogo({ name, logo, className }: { name: string; logo: string | null | undefined; className?: string }) {
  if (logo) return <img src={logo} alt="" className={cn('size-8 shrink-0 rounded-lg border bg-white object-contain', className)} />
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className={cn('bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold', className)}>
      {initials || '?'}
    </div>
  )
}
