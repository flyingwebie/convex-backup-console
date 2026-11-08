import { createServerFn } from '@tanstack/react-start'
import { db } from './db.server'
import { requireWorkspace } from './workspace.server'

/**
 * Storage-page-only server functions. The schema has no notion of "which tier a backup currently
 * occupies" — jobs carry a keep_last/daily/weekly/monthly *policy*, but a destination can receive
 * copies from several jobs with different policies, so there's no single policy to read per
 * destination. Instead this derives an observed tier breakdown cheaply from the live (non-deleted,
 * ok) copies already stored for each destination: the newest copy is "latest", copies from the
 * last 7 days bucket by distinct calendar day ("daily"), the next ~8 weeks bucket by ISO week
 * ("weekly"), and anything older buckets by calendar month ("monthly"). This is an approximation
 * of the real grandfather-father-son retention selection (see retention.ts), not a replay of it —
 * good enough to show "what's actually sitting in this destination right now", which is what the
 * design calls for.
 */

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${week}`
}

const DAY = 86_400_000

export const getStorageRetention = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  const destinations = db().prepare('SELECT id FROM destinations WHERE workspace_id = ? AND deleted_at IS NULL').all(ws.id) as { id: string }[]

  const tiers = destinations.map((d) => {
    const rows = db()
      .prepare(
        `SELECT r.started_at AS at FROM run_copies c JOIN runs r ON r.id = c.run_id
         WHERE c.destination_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL ORDER BY r.started_at DESC`,
      )
      .all(d.id) as { at: number }[]

    const now = Date.now()
    const seenDays = new Set<string>()
    const seenWeeks = new Set<string>()
    const seenMonths = new Set<string>()
    let latest = 0
    let daily = 0
    let weekly = 0
    let monthly = 0

    rows.forEach((row, i) => {
      if (i === 0) latest = 1
      const age = now - row.at
      const date = new Date(row.at)
      if (age <= 7 * DAY) {
        const key = date.toISOString().slice(0, 10)
        if (!seenDays.has(key)) {
          seenDays.add(key)
          daily++
        }
      } else if (age <= 56 * DAY) {
        const key = isoWeek(date)
        if (!seenWeeks.has(key)) {
          seenWeeks.add(key)
          weekly++
        }
      } else {
        const key = date.toISOString().slice(0, 7)
        if (!seenMonths.has(key)) {
          seenMonths.add(key)
          monthly++
        }
      }
    })

    return { id: d.id, kept: rows.length, oldest: rows.at(-1)?.at ?? null, latest, daily, weekly, monthly }
  })

  return { tiers }
})
