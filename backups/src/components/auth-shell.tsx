import type { ReactNode } from 'react'
import { LifeBuoy } from 'lucide-react'

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
          <LifeBuoy className="size-4" />
        </div>
        Convex Backup Console
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
