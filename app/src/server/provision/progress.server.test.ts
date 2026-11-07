import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetProvisionProgressForTests,
  finishProvisionProgress,
  getProvisionProgress,
  recordProvisionSteps,
  startProvisionProgress,
} from './progress.server'
import type { ProvisionStep } from './helpers'

const step = (id: string, label = id): ProvisionStep => ({ id, label, status: 'ok' })

beforeEach(() => {
  __resetProvisionProgressForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getProvisionProgress', () => {
  it('returns undefined for an unknown id', () => {
    expect(getProvisionProgress('ws1', 'does-not-exist')).toBeUndefined()
  })

  it('returns steps recorded so far while a run is in progress', () => {
    startProvisionProgress('ws1', 'run-1')
    expect(getProvisionProgress('ws1', 'run-1')).toEqual({ steps: [], done: false })

    recordProvisionSteps('ws1', 'run-1', [step('verify')])
    expect(getProvisionProgress('ws1', 'run-1')).toEqual({ steps: [step('verify')], done: false })

    recordProvisionSteps('ws1', 'run-1', [step('verify'), step('bucket')])
    expect(getProvisionProgress('ws1', 'run-1')).toEqual({ steps: [step('verify'), step('bucket')], done: false })
  })

  it('marks done once the run finishes, keeping the final steps readable', () => {
    startProvisionProgress('ws1', 'run-2')
    recordProvisionSteps('ws1', 'run-2', [step('verify'), step('bucket')])
    finishProvisionProgress('ws1', 'run-2')
    expect(getProvisionProgress('ws1', 'run-2')).toEqual({ steps: [step('verify'), step('bucket')], done: true })
  })

  it('snapshots steps by value — mutating the array passed to recordProvisionSteps afterwards does not change what was recorded', () => {
    startProvisionProgress('ws1', 'run-3')
    const steps = [step('verify')]
    recordProvisionSteps('ws1', 'run-3', steps)
    steps.push(step('bucket'))
    expect(getProvisionProgress('ws1', 'run-3')?.steps).toEqual([step('verify')])
  })

  it('recording or finishing an id that was never started is a no-op, not a throw', () => {
    expect(() => recordProvisionSteps('ws1', 'never-started', [step('verify')])).not.toThrow()
    expect(() => finishProvisionProgress('ws1', 'never-started')).not.toThrow()
    expect(getProvisionProgress('ws1', 'never-started')).toBeUndefined()
  })
})

describe('workspace isolation', () => {
  it('a different workspace cannot read a run even with the exact same progress id', () => {
    startProvisionProgress('ws1', 'shared-id')
    recordProvisionSteps('ws1', 'shared-id', [step('verify')])
    expect(getProvisionProgress('ws2', 'shared-id')).toBeUndefined()
    expect(getProvisionProgress('ws1', 'shared-id')).toEqual({ steps: [step('verify')], done: false })
  })

  it('two workspaces can run with the same progress id concurrently without colliding', () => {
    startProvisionProgress('ws1', 'same-id')
    startProvisionProgress('ws2', 'same-id')
    recordProvisionSteps('ws1', 'same-id', [step('verify')])
    recordProvisionSteps('ws2', 'same-id', [step('verify'), step('bucket')])
    expect(getProvisionProgress('ws1', 'same-id')).toEqual({ steps: [step('verify')], done: false })
    expect(getProvisionProgress('ws2', 'same-id')).toEqual({ steps: [step('verify'), step('bucket')], done: false })
  })
})

describe('no secrets ever stored', () => {
  it('only ever holds the public ProvisionStep shape — no room for a secret field to hide in', () => {
    startProvisionProgress('ws1', 'run-4')
    const withExtra = { id: 'token', label: 'Mint a scoped access token', status: 'ok' as const, detail: 'Account-owned token' }
    recordProvisionSteps('ws1', 'run-4', [withExtra])
    const read = getProvisionProgress('ws1', 'run-4')
    expect(read?.steps[0]).toEqual(withExtra)
    // Every key on every recorded step must be one of ProvisionStep's own keys — nothing else
    // (e.g. accessKeyId/secretAccessKey/setupToken) can ride along.
    const allowedKeys = new Set(['id', 'label', 'status', 'detail', 'ms'])
    for (const s of read?.steps ?? []) {
      for (const k of Object.keys(s)) expect(allowedKeys.has(k)).toBe(true)
    }
  })
})

describe('expiry', () => {
  it('a finished run is still readable right away, then disappears after the 10 minute TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    startProvisionProgress('ws1', 'run-5')
    recordProvisionSteps('ws1', 'run-5', [step('verify')])
    finishProvisionProgress('ws1', 'run-5')
    expect(getProvisionProgress('ws1', 'run-5')).toEqual({ steps: [step('verify')], done: true })

    vi.setSystemTime(10 * 60 * 1000 - 1)
    expect(getProvisionProgress('ws1', 'run-5')).toEqual({ steps: [step('verify')], done: true })

    vi.setSystemTime(10 * 60 * 1000 + 1)
    expect(getProvisionProgress('ws1', 'run-5')).toBeUndefined()
  })

  it('a run that never finishes never expires on its own', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    startProvisionProgress('ws1', 'run-6')
    recordProvisionSteps('ws1', 'run-6', [step('verify')])
    vi.setSystemTime(365 * 24 * 60 * 60 * 1000)
    expect(getProvisionProgress('ws1', 'run-6')).toEqual({ steps: [step('verify')], done: false })
  })

  it('sweeping an expired entry for one run does not evict unrelated unfinished or unexpired runs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    startProvisionProgress('ws1', 'finishes-early')
    finishProvisionProgress('ws1', 'finishes-early')
    startProvisionProgress('ws1', 'still-running')
    recordProvisionSteps('ws1', 'still-running', [step('verify')])

    vi.setSystemTime(10 * 60 * 1000 + 1)
    expect(getProvisionProgress('ws1', 'finishes-early')).toBeUndefined()
    expect(getProvisionProgress('ws1', 'still-running')).toEqual({ steps: [step('verify')], done: false })
  })
})
