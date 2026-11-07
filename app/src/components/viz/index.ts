// Visual-connection primitives (DESIGN.md §5) — the reusable vocabulary for "show the
// relationship" used identically on Overview (topology), Runs (pipeline + breadcrumbs +
// lineage), Jobs (breadcrumb chips), Storage (retention timeline). Reuse these rather than
// inventing new ad-hoc widgets on a screen pass.
export { StatusDot, type DotStatus } from './status-dot'
export { EntityChip, BreadcrumbTrail } from './entity-chip'
export { entityHref, type FocusableEntityKind } from './entity-href'
export { NodeCard } from './node-card'
export { PipelineSteps, type PipelineStepItem, type PipelineStepStatus } from './pipeline-steps'
export { TopologyMap, type TopologyNode, type TopologyEdge, type EdgeHealth } from './topology-map'
export { ENTITY_ICON, ENTITY_TINT, type EntityKind } from './entity-kind'
