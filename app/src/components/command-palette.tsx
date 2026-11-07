import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CloudCog, CornerDownLeft, HardDrive, Moon, Plus, Sun, UserRound } from 'lucide-react'
import { useTheme } from 'next-themes'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { nav } from '~/components/app-sidebar'
import { ENTITY_ICON, ENTITY_TINT, type EntityKind } from '~/components/viz'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '~/components/ui/command'
import { cn } from '~/lib/utils'
import { can } from '~/lib/permissions'
import { useWorkspace } from '~/lib/use-workspace'
import { getCommandPaletteEntities } from '~/server/command-palette-fns'

const CommandPaletteContext = createContext<{ open: () => void } | null>(null)

/**
 * Wraps the app shell once (`_app.tsx`) so both the sidebar's ⌘K hint chip and every page
 * header's search trigger (`CommandPaletteTrigger`) can open the same palette without prop
 * drilling.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useCommandPaletteShortcut(setOpen)
  return (
    <CommandPaletteContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </CommandPaletteContext.Provider>
  )
}

/** Opens the global command palette — used by the sidebar hint chip and the page-header trigger. */
export function useOpenCommandPalette() {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) throw new Error('useOpenCommandPalette must be used within CommandPaletteProvider')
  return ctx.open
}

/** The tinted icon square used in front of every "Jump to" / "Actions" row (DESIGN.md §5.5's
 * entity-kind tint, reused here as the palette's icon-square language — not a generic dot). */
function PaletteIcon({ icon: Icon, tint }: { icon: typeof Plus; tint?: { bg: string; fg: string } }) {
  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md',
        tint ? tint.bg : 'bg-muted',
      )}
    >
      <Icon className={cn('size-3.5', tint ? tint.fg : 'text-muted-foreground')} />
    </span>
  )
}

/**
 * Global ⌘K command palette. Mounted once by `CommandPaletteProvider`; manages its own open
 * state and keyboard shortcut (⌘K / Ctrl+K, and the sidebar's hint-chip click).
 *
 * Groups, in order (DESIGN.md §3 / command-palette design pass): **Jump to** — live entity
 * results (instances/jobs/destinations by name, each with its tinted entity-kind icon square and
 * a mono meta fragment), only while there's a query; **Actions** — quick-create shortcuts that
 * deep-link to the target page's existing dialog via an `?action=` search param, plus theme
 * toggle; **Navigate** — the sidebar's own destinations, filtered by permission.
 */
function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { role } = useWorkspace()
  const { theme, setTheme } = useTheme()
  const [query, setQuery] = useState('')
  const getEntities = useServerFn(getCommandPaletteEntities)
  const [entities, setEntities] = useState<Awaited<ReturnType<typeof getCommandPaletteEntities>> | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    let cancelled = false
    void getEntities().then((r) => !cancelled && setEntities(r))
    return () => {
      cancelled = true
    }
  }, [open, getEntities])

  function go(to: string, search?: Record<string, string>) {
    onOpenChange(false)
    void navigate({ to, search: search as never })
  }

  const jumpResults = useMemo(() => {
    if (!entities || query.trim().length === 0) return []
    const q = query.trim().toLowerCase()
    const rows: { kind: EntityKind; id: string; name: string; meta: string; to: string }[] = []
    for (const i of entities.instances) if (i.name.toLowerCase().includes(q)) rows.push({ kind: 'instance', id: i.id, name: i.name, meta: i.meta, to: '/instances' })
    for (const j of entities.jobs) if (j.name.toLowerCase().includes(q)) rows.push({ kind: 'job', id: j.id, name: j.name, meta: j.meta, to: '/jobs' })
    for (const d of entities.destinations) if (d.name.toLowerCase().includes(q)) rows.push({ kind: 'destination', id: d.id, name: d.name, meta: d.meta, to: '/destinations' })
    return rows.slice(0, 8)
  }, [entities, query])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a page or run a quick action">
      <CommandInput placeholder="Jump to a page or run a command…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {jumpResults.length > 0 && (
          <>
            <CommandGroup heading="Jump to">
              {jumpResults.map((r) => (
                <CommandItem key={`${r.kind}-${r.id}`} value={`jump-${r.kind}-${r.name}`} onSelect={() => go(r.to)}>
                  <PaletteIcon icon={ENTITY_ICON[r.kind]} tint={ENTITY_TINT[r.kind]} />
                  <span className="truncate">{r.name}</span>
                  <span className="text-muted-foreground ml-1.5 truncate font-mono text-xs">{r.meta}</span>
                  <span className="text-muted-foreground ml-auto text-xs capitalize">{r.kind}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go('/jobs', { action: 'new' })}>
            <PaletteIcon icon={Plus} /> New job
          </CommandItem>
          <CommandItem onSelect={() => go('/destinations', { action: 'add' })}>
            <PaletteIcon icon={HardDrive} /> Add destination
          </CommandItem>
          <CommandItem onSelect={() => go('/destinations', { action: 'provision' })}>
            <PaletteIcon icon={CloudCog} /> Create a bucket for me
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false)
              setTheme(theme === 'dark' ? 'light' : 'dark')
            }}
          >
            <PaletteIcon icon={theme === 'dark' ? Sun : Moon} /> Toggle theme
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {nav
            .flatMap((g) => g.items)
            .filter((item) => !item.need || can(role, item.need))
            .map((item) => (
              <CommandItem key={item.to} value={`nav-${item.label}`} onSelect={() => go(item.to)}>
                <PaletteIcon icon={item.icon} /> {item.label}
              </CommandItem>
            ))}
          {can(role, 'manage') && (
            <CommandItem value="nav-account" onSelect={() => go('/account')}>
              <PaletteIcon icon={UserRound} /> Account & security
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
      <div className="text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-xs">
        <span className="flex items-center gap-1">
          <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> Navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="bg-muted flex items-center rounded border px-1 py-0.5 font-mono text-[10px]"><CornerDownLeft className="size-2.5" /></kbd> Open
        </span>
        <span className="flex items-center gap-1">
          <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">esc</kbd> Close
        </span>
      </div>
    </CommandDialog>
  )
}

/** Opens the palette on ⌘K / Ctrl+K from anywhere in the app shell. */
function useCommandPaletteShortcut(setOpen: (fn: (open: boolean) => boolean) => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setOpen])
}
