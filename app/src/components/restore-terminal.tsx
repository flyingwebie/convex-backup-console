import { useServerFn } from '@tanstack/react-start'
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { cn } from '~/lib/utils'
import { getRestoreLog } from '~/server/fns'

type Line = Awaited<ReturnType<typeof getRestoreLog>>['lines'][number]
type Status = 'running' | 'ok' | 'failed'

const LEVEL: Record<Line['level'], string> = {
  info: 'text-zinc-200',
  dim: 'text-zinc-500',
  success: 'text-emerald-400',
  warn: 'text-amber-300',
  error: 'text-red-400',
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour12: false })

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Terminal-style live view of a restore's log. Polls every second while the restore runs and
 * follows the output unless the user scrolls up.
 */
export function RestoreTerminal({
  restoreId,
  title,
  status: initialStatus,
  startedAt,
  finishedAt,
  fallback,
}: {
  restoreId: string
  title: string
  status: Status
  startedAt: number
  finishedAt: number | null
  /** Shown when the restore has no log (it ran before live logs existed). */
  fallback?: string | null
}) {
  const fetchLog = useServerFn(getRestoreLog)
  const router = useRouter()
  const [lines, setLines] = useState<Line[]>([])
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<Status>(initialStatus)
  const [end, setEnd] = useState<number | null>(finishedAt)
  const [now, setNow] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const lastId = useRef(0)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        // Drain in pages (a finished restore loads its whole log at once).
        for (;;) {
          const res = await fetchLog({ data: { id: restoreId, after: lastId.current } })
          if (stop) return
          if (res.lines.length) {
            lastId.current = res.lines[res.lines.length - 1].id
            setLines((prev) => [...prev, ...res.lines])
          }
          setStatus((prev) => {
            // Refresh the page data (badge, documents written) once the restore ends.
            if (prev === 'running' && res.status !== 'running') void router.invalidate()
            return res.status
          })
          setEnd(res.finished_at)
          if (res.lines.length < 2000) {
            setLoaded(true)
            if (res.status === 'running') timer = setTimeout(tick, 1000)
            return
          }
        }
      } catch {
        if (!stop) timer = setTimeout(tick, 3000)
      }
    }
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [restoreId])

  // Elapsed clock (client-only to avoid hydration mismatches).
  useEffect(() => {
    setNow(Date.now())
    if (status !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [status])

  useEffect(() => {
    const el = body.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  }, [lines, loaded, status])

  const text = lines.map((l) => `[${clock(l.at)}] ${l.text}`).join('\n') || fallback || ''
  const running = status === 'running'

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200 shadow-inner">
      <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-red-500/80" />
          <span className="size-2.5 rounded-full bg-amber-400/80" />
          <span className="size-2.5 rounded-full bg-emerald-500/80" />
        </div>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-400">{title}</span>
        <span
          className={cn(
            'flex items-center gap-1.5 font-mono text-[11px]',
            running ? 'text-sky-400' : status === 'ok' ? 'text-emerald-400' : 'text-red-400',
          )}
        >
          <span className={cn('size-1.5 rounded-full bg-current', running && 'animate-pulse')} />
          {running ? 'running' : status === 'ok' ? 'done' : 'failed'}
          {now != null && <span className="text-zinc-500">· {elapsed((end ?? now) - startedAt)}</span>}
        </span>
        <button
          type="button"
          className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          title="Copy log"
          onClick={() => {
            void navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <div
        ref={body}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="max-h-96 min-h-32 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-5"
      >
        {!loaded && lines.length === 0 && <div className="text-zinc-500">Connecting…</div>}
        {loaded && lines.length === 0 && (
          <div className="whitespace-pre text-zinc-500">
            {fallback ? fallback : running ? 'Waiting for output…' : 'No log was recorded for this restore.'}
          </div>
        )}
        {lines.map((l) => (
          <div key={l.id} className="flex gap-3 whitespace-pre">
            <span className="shrink-0 text-zinc-600 select-none">{clock(l.at)}</span>
            <span className={LEVEL[l.level]}>{l.text || ' '}</span>
          </div>
        ))}
        {running && (
          <div className="flex gap-3">
            <span className="shrink-0 text-zinc-600 select-none">{now != null ? clock(now) : ''}</span>
            <span className="inline-block h-4 w-2 animate-pulse bg-zinc-300" />
          </div>
        )}
      </div>
    </div>
  )
}
