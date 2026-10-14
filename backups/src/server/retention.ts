export type RetentionPolicy = {
  keepLast: number | null
  keepDaily: number | null
  keepWeekly: number | null
  keepMonthly: number | null
}

/**
 * Grandfather-father-son retention. Returns the ids to keep from `items` (any order).
 * keepLast keeps the N newest; keepDaily/Weekly/Monthly keep the newest backup of each of the
 * N most recent days/ISO weeks/months that have a backup. A policy with no limits keeps everything.
 */
export function selectToKeep(items: { id: string; at: number }[], policy: RetentionPolicy): Set<string> {
  const sorted = [...items].sort((a, b) => b.at - a.at)
  const { keepLast, keepDaily, keepWeekly, keepMonthly } = policy
  if (!keepLast && !keepDaily && !keepWeekly && !keepMonthly) return new Set(sorted.map((i) => i.id))

  const keep = new Set<string>()
  sorted.slice(0, keepLast ?? 0).forEach((i) => keep.add(i.id))
  const bucket = (limit: number | null, key: (d: Date) => string) => {
    if (!limit) return
    const seen = new Set<string>()
    for (const item of sorted) {
      const k = key(new Date(item.at))
      if (seen.has(k)) continue
      seen.add(k)
      keep.add(item.id)
      if (seen.size >= limit) break
    }
  }
  bucket(keepDaily, (d) => d.toISOString().slice(0, 10))
  bucket(keepWeekly, isoWeek)
  bucket(keepMonthly, (d) => d.toISOString().slice(0, 7))
  return keep
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${week}`
}
