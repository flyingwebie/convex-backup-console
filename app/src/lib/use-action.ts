import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

/** Runs a mutation, toasts the result and refreshes route data. */
export function useAction() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function run<T>(fn: () => Promise<T>, opts: { success?: string | ((r: T) => string) } = {}): Promise<T | undefined> {
    setPending(true)
    try {
      const result = await fn()
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(result) : opts.success)
      await router.invalidate()
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return undefined
    } finally {
      setPending(false)
    }
  }
  return { run, pending }
}

/** Re-fetches route data every `ms` while `active` (e.g. while a backup is running). */
export function usePolling(active: boolean, ms = 3000) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => void router.invalidate(), ms)
    return () => clearInterval(t)
  }, [active, ms, router])
}
