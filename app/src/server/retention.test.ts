import { describe, expect, it } from 'vitest'
import { selectToKeep } from './retention'

const DAY = 86_400_000
const t0 = Date.UTC(2026, 9, 14, 3) // Wed 14 Oct 2026, 03:00 UTC
// One backup per day at 03:00 going back 120 days, plus an extra one today at 15:00.
const items = [
  { id: 'today-15', at: t0 + 12 * 3_600_000 },
  ...Array.from({ length: 120 }, (_, i) => ({ id: `d${i}`, at: t0 - i * DAY })),
]
const none = { keepLast: null, keepDaily: null, keepWeekly: null, keepMonthly: null }

describe('selectToKeep', () => {
  it('keeps everything without a policy', () => {
    expect(selectToKeep(items, none).size).toBe(items.length)
  })

  it('keepLast keeps the newest N', () => {
    expect([...selectToKeep(items, { ...none, keepLast: 2 })]).toEqual(['today-15', 'd0'])
  })

  it('keepDaily keeps the newest backup of each day', () => {
    const keep = selectToKeep(items, { ...none, keepDaily: 3 })
    expect([...keep]).toEqual(['today-15', 'd1', 'd2'])
  })

  it('combines tiers (1 last, 7 daily, 4 weekly, 3 monthly)', () => {
    const keep = selectToKeep(items, { keepLast: 1, keepDaily: 7, keepWeekly: 4, keepMonthly: 3 })
    // daily:   Oct 14 (today-15), Oct 13..8 (d1..d6)
    // weekly:  ISO W42 today-15, W41 d3 (Sun 11 Oct), W40 d10 (Sun 4 Oct), W39 d17 (Sun 27 Sep)
    // monthly: Oct today-15, Sep d14 (30 Sep), Aug d44 (31 Aug)
    expect([...keep].sort()).toEqual(['d1', 'd10', 'd14', 'd17', 'd2', 'd3', 'd4', 'd44', 'd5', 'd6', 'today-15'])
  })

  it('never deletes the newest backup when any limit is set', () => {
    const keep = selectToKeep(items, { ...none, keepMonthly: 1 })
    expect([...keep]).toEqual(['today-15'])
  })
})
