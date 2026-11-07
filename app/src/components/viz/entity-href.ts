// List pages that support the `?focus=<id>` deep link (see useFocusRow in ~/hooks/use-focus-row and
// each route's `validateSearch`). Runs isn't wired up yet, so it's deliberately left out of this map.
const FOCUSABLE_LIST_PATH = {
  instance: '/instances',
  job: '/jobs',
  destination: '/destinations',
} as const

export type FocusableEntityKind = keyof typeof FOCUSABLE_LIST_PATH

/**
 * Builds a `{ to, search }` pair that deep-links straight to one row on its list page instead of just
 * the bare list (DESIGN.md §5.5's linked-entity chip). The target route scrolls the matching row into
 * view and flashes it briefly — see `useFocusRow`.
 *
 * Purely additive: it doesn't change `EntityChip`'s existing `to`-only API. Spread it onto an
 * `EntityChip` (`<EntityChip kind="job" name={j.name} {...entityHref('job', j.id)} />`, which forwards
 * `search` to the underlying `Link`), or pass it straight to `navigate()`/`Link`, as the ⌘K command
 * palette does for its "Jump to" results.
 */
export function entityHref(kind: FocusableEntityKind, id: string): { to: string; search: { focus: string } } {
  return { to: FOCUSABLE_LIST_PATH[kind], search: { focus: id } }
}
