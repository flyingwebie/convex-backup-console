// In-memory, per-process live-progress store for "Create bucket for me" (see provisionDestination in
// ~/server/fns.ts and index.server.ts). The client generates a provisioning id up front, starts the
// (awaited) provisionDestination request with that id, and separately polls getProvisionProgress({id})
// every ~500ms to render steps as they happen instead of waiting for the whole request to resolve.
//
// Entries are keyed by `${workspaceId}:${id}` so a run is only ever readable by the workspace that
// started it (the caller still re-checks requireWorkspace('manage') on every read/write — this store
// adds isolation, not authorization). Entries expire ~10 minutes after the run finishes so this Map
// can't grow unbounded; a sweep runs opportunistically on every read/write rather than on a timer, so
// nothing needs to be torn down between requests/process restarts.
//
// NEVER put setup credentials (or anything beyond the same ProvisionStep[] shape already returned to
// the client at the end of a run) into an entry here.
import type { ProvisionStep } from './helpers'

type Entry = {
  workspaceId: string
  steps: ProvisionStep[]
  done: boolean
  /** Set once `done` is true; the entry is swept once `Date.now()` passes this. Null while running. */
  expiresAt: number | null
}

const TTL_AFTER_DONE_MS = 10 * 60 * 1000

const store = new Map<string, Entry>()

function key(workspaceId: string, id: string) {
  return `${workspaceId}:${id}`
}

function sweep(now = Date.now()) {
  for (const [k, e] of store) {
    if (e.expiresAt !== null && e.expiresAt <= now) store.delete(k)
  }
}

/** Registers a fresh, empty progress entry right before a provisioning run starts. */
export function startProvisionProgress(workspaceId: string, id: string): void {
  sweep()
  store.set(key(workspaceId, id), { workspaceId, steps: [], done: false, expiresAt: null })
}

/** Snapshots the run's current steps (called on every push to the underlying `steps[]`). */
export function recordProvisionSteps(workspaceId: string, id: string, steps: ProvisionStep[]): void {
  const e = store.get(key(workspaceId, id))
  if (!e) return
  e.steps = steps.slice()
}

/** Marks a run finished. The entry stays readable for `TTL_AFTER_DONE_MS` so a trailing poll still sees it. */
export function finishProvisionProgress(workspaceId: string, id: string): void {
  const e = store.get(key(workspaceId, id))
  if (!e) return
  e.done = true
  e.expiresAt = Date.now() + TTL_AFTER_DONE_MS
}

/** Reads a run's progress. Returns undefined if the id is unknown, expired, or belongs to another workspace. */
export function getProvisionProgress(workspaceId: string, id: string): { steps: ProvisionStep[]; done: boolean } | undefined {
  sweep()
  const e = store.get(key(workspaceId, id))
  if (!e || e.workspaceId !== workspaceId) return undefined
  return { steps: e.steps, done: e.done }
}

/** Test-only: clears the whole store so tests don't bleed into each other. */
export function __resetProvisionProgressForTests(): void {
  store.clear()
}
