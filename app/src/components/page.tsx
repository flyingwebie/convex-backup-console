import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { useOpenCommandPalette } from '~/components/command-palette'
import { Separator } from '~/components/ui/separator'
import { SidebarTrigger } from '~/components/ui/sidebar'

/**
 * The page header pattern every route uses: a slim top bar (sidebar trigger + breadcrumb-style
 * title + ⌘K search trigger) and a larger title/description/actions row below it. Keep this as
 * the one place that pattern is defined — screen-level passes restyle their own body content,
 * not this chrome.
 */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const openPalette = useOpenCommandPalette()
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-sm font-medium">{title}</h1>
        <button
          type="button"
          onClick={openPalette}
          className="text-muted-foreground hover:text-foreground hover:bg-accent ml-auto flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors"
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="bg-muted hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline-block">⌘K</kbd>
        </button>
      </header>
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </>
  )
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6 p-6">{children}</div>
}
