import { useEffect, useRef, useState } from 'react'

/**
 * Scrolls the row matching `focusId` into view and applies a brief highlight once, when `id` equals
 * it. Backs the ⌘K "Jump to" deep link: the command palette (command-palette.tsx) navigates to
 * `/instances|/jobs/destinations?focus=<id>` (built with `entityHref`, see
 * ~/components/viz/entity-href.ts), each route's `validateSearch` accepts `focus`, and the row
 * component for that id calls this hook.
 *
 * No prefers-reduced-motion feature-detection is needed here: the global reduced-motion rule in
 * styles.css already forces `scroll-behavior: auto` and collapses every animation/transition
 * duration to ~0, so the smooth scroll and the highlight's fade both degrade to an instant, static
 * flash for free.
 */
export function useFocusRow<T extends HTMLElement>(id: string, focusId: string | null | undefined) {
  const ref = useRef<T | null>(null)
  const [highlight, setHighlight] = useState(false)
  const firedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!focusId || focusId !== id || firedFor.current === focusId || !ref.current) return
    firedFor.current = focusId
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlight(true)
    const t = setTimeout(() => setHighlight(false), 1600)
    return () => clearTimeout(t)
  }, [focusId, id])

  return { ref, highlight }
}
