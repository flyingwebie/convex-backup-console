export function formatBytes(n: number | null | undefined) {
  if (n == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i && v < 10 ? 1 : 0)} ${units[i]}`
}

export function formatDate(ts: number | null | undefined) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function timeAgo(ts: number | null | undefined) {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  const future = diff < 0
  const s = Math.abs(diff) / 1000
  const [v, unit] =
    s < 60 ? [s, 'second'] : s < 3600 ? [s / 60, 'minute'] : s < 86400 ? [s / 3600, 'hour'] : [s / 86400, 'day']
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(future ? v : -v), unit as Intl.RelativeTimeFormatUnit)
}

export function duration(start: number, end: number | null) {
  if (!end) return null
  const s = Math.round((end - start) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const PRESETS: Record<string, string> = {
  '0 * * * *': 'Every hour',
  '0 */6 * * *': 'Every 6 hours',
  '0 */12 * * *': 'Every 12 hours',
  '0 3 * * *': 'Daily at 03:00 UTC',
  '0 3 * * 0': 'Weekly, Sunday 03:00 UTC',
  '0 3 1 * *': 'Monthly, 1st at 03:00 UTC',
}
export const CRON_PRESETS = Object.entries(PRESETS)

export function describeCron(cron: string | null) {
  if (!cron) return 'Manual only'
  return PRESETS[cron] ?? cron
}

export function describeRetention(j: { keep_last: number | null; keep_daily: number | null; keep_weekly: number | null; keep_monthly: number | null }) {
  const parts = [
    j.keep_last && `last ${j.keep_last}`,
    j.keep_daily && `${j.keep_daily} daily`,
    j.keep_weekly && `${j.keep_weekly} weekly`,
    j.keep_monthly && `${j.keep_monthly} monthly`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Keep all'
}
