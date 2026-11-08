import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { cn } from '~/lib/utils'
import { ENTITY_ICON, ENTITY_TINT, type EntityKind } from './viz/entity-kind'

/**
 * AuthVaultPanel — the dark "vault" brand panel shown on the left of every unauthenticated/
 * onboarding screen (login, verify, setup, security, invite, no-workspace; see DESIGN.md §6,
 * screens 1–6). It's illustrative branding, not live data: every screen shows the same example
 * topology (prod-eu-01 → nightly-prod → prod-eu-backups) built from the same visual-connection
 * primitives used once a workspace exists (NodeCard-style tiles + Edge-style connectors, §5), so
 * the pattern a new operator learns here is the one they'll see for real on Overview.
 *
 * `stage` controls how much of the picture has "resolved" — the setup wizard's panel builds up
 * step by step (dashed placeholder → secured lock badge → first instance → full topology) so the
 * wizard's own progress is mirrored spatially, not just by the step indicator above the form.
 */
export type VaultStage = 'empty' | 'secured' | 'instance' | 'graph' | 'disconnected'

type Members = { initials: string[]; label: string }

const NODES: { kind: EntityKind; title: string; subtitle: string }[] = [
  { kind: 'instance', title: 'prod-eu-01', subtitle: 'self-hosted.example.com' },
  { kind: 'job', title: 'nightly-prod', subtitle: '0 */6 * * *' },
  { kind: 'destination', title: 'prod-eu-backups', subtitle: 'R2 · eu' },
]

// Fixed layout coordinates (px, inside a relatively-positioned box) — the vault graphic is a
// static illustration, not a live-measured diagram like TopologyMap, so a hand-tuned stair-step
// layout is simpler and cheaper than a ResizeObserver for three tiles that never move.
const POS = [
  { x: 0, y: 0 },
  { x: 64, y: 148 },
  { x: 126, y: 296 },
]
const NODE_W = 198
const NODE_H = 72
const BOX_W = POS[2].x + NODE_W
const BOX_H = POS[2].y + NODE_H

export function AuthVaultPanel({ stage, caption, members }: { stage: VaultStage; caption: string; members?: Members }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex flex-1 items-center justify-center py-10">
        {stage === 'graph' ? (
          <Graph members={members} />
        ) : stage === 'instance' ? (
          <SingleNode index={0} ring dot="success" />
        ) : stage === 'secured' ? (
          <SingleNode index={0} dot={null} badge={<LockBadge />} title="Account secured" subtitle="2FA enrolled" progress={0.66} />
        ) : stage === 'disconnected' ? (
          <SingleNode index={0} dashed dot="muted" title="No instance" subtitle="not connected" progress={0.2} />
        ) : (
          <SingleNode index={0} dashed dot={null} title="Not connected yet" subtitle="" progress={0.33} />
        )}
      </div>
      <p className="max-w-xs text-sm leading-relaxed text-white/50">{caption}</p>
    </div>
  )
}

function LockBadge() {
  return (
    <span className="absolute -top-2.5 -right-2.5 z-10 flex size-6 items-center justify-center rounded-full border border-white/15 bg-[#0b0d16] text-white shadow-[0_2px_8px_rgb(0_0_0/0.4)]">
      <Lock className="size-3" />
    </span>
  )
}

function Graph({ members }: { members?: Members }) {
  return (
    <div className="relative" style={{ width: BOX_W, height: members ? BOX_H + 90 : BOX_H }}>
      {NODES.map((n, i) => (
        <div key={n.kind} className="absolute" style={{ left: POS[i].x, top: POS[i].y, width: NODE_W }}>
          <VaultTile kind={n.kind} title={n.title} subtitle={n.subtitle} dot="success" />
        </div>
      ))}
      <Elbow from={POS[0]} to={POS[1]} label="every 6h" />
      <Elbow from={POS[1]} to={POS[2]} label="2h ago" />
      {members && <MembersBranch from={POS[0]} top={BOX_H + 10} members={members} />}
    </div>
  )
}

function SingleNode({
  index,
  dashed,
  ring,
  dot,
  badge,
  title,
  subtitle,
  progress,
}: {
  index: number
  dashed?: boolean
  ring?: boolean
  dot?: 'success' | 'muted' | null
  badge?: ReactNode
  title?: string
  subtitle?: string
  progress?: number
}) {
  const node = NODES[index]
  return (
    <div style={{ width: NODE_W }}>
      <VaultTile
        kind={node.kind}
        title={title ?? node.title}
        subtitle={subtitle ?? node.subtitle}
        dashed={dashed}
        ring={ring}
        dot={dot}
        badge={badge}
      />
      {progress != null && (
        <div className="mt-2.5 ml-1 h-1 w-16 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-white/30" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  )
}

function VaultTile({
  kind,
  title,
  subtitle,
  dashed,
  ring,
  dot,
  badge,
}: {
  kind: EntityKind
  title: string
  subtitle: string
  dashed?: boolean
  ring?: boolean
  dot?: 'success' | 'muted' | null
  badge?: ReactNode
}) {
  const Icon = ENTITY_ICON[kind]
  const tint = ENTITY_TINT[kind]
  return (
    <div
      className={cn(
        'relative flex items-center gap-2.5 rounded-lg border p-3',
        dashed ? 'border-dashed border-white/20 bg-transparent' : 'border-white/15 bg-white/[0.04]',
        ring && 'outline outline-2 outline-offset-2 outline-white/25',
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      {badge}
      {dot && (
        <span className={cn('absolute top-2.5 right-2.5 size-1.5 rounded-full', dot === 'success' ? 'bg-success' : 'bg-white/25')} />
      )}
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          dashed ? 'bg-white/5 text-white/30' : cn(tint.bg, tint.fg),
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-medium', dashed ? 'text-white/40' : 'text-white')}>{title}</div>
        {subtitle && <div className={cn('truncate font-mono text-xs', dashed ? 'text-white/25' : 'text-white/45')}>{subtitle}</div>}
      </div>
    </div>
  )
}

/** Orthogonal elbow connector between two stacked tiles, DESIGN.md §5.2's Edge drawn statically. */
function Elbow({ from, to, label }: { from: { x: number; y: number }; to: { x: number; y: number }; label?: string }) {
  const turnX = from.x + 24
  const fromBottom = from.y + NODE_H
  const turnY = to.y + NODE_H / 2
  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      <path
        d={`M ${turnX} ${fromBottom} V ${turnY} H ${to.x}`}
        fill="none"
        stroke="var(--success)"
        strokeOpacity={0.7}
        strokeWidth={1.5}
      />
      {label && (
        <g transform={`translate(${turnX}, ${turnY})`}>
          <rect x={-2} y={-8} width={label.length * 5.6 + 10} height={16} rx={8} fill="#0b0d16" stroke="rgb(255 255 255 / 0.1)" />
          <text x={3} y={3} className="font-mono" fontSize={10} fill="rgb(255 255 255 / 0.5)">
            {label}
          </text>
        </g>
      )}
    </svg>
  )
}

const AVATAR_TINTS = ['bg-chart-1 text-white', 'bg-chart-2 text-white', 'bg-chart-5 text-white']

function MembersBranch({ from, top, members }: { from: { x: number; y: number }; top: number; members: Members }) {
  const x = from.x + 24
  const fromBottom = from.y + NODE_H
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
        <path d={`M ${x} ${fromBottom} V ${top}`} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth={1.5} />
      </svg>
      <div className="absolute flex items-center gap-2" style={{ left: 0, top: top + 6 }}>
        <div className="flex -space-x-2">
          {members.initials.map((initial, i) => (
            <span
              key={initial + i}
              className={cn(
                'flex size-7 items-center justify-center rounded-full border-2 border-[#0b0d16] text-[11px] font-medium',
                AVATAR_TINTS[i % AVATAR_TINTS.length],
              )}
            >
              {initial}
            </span>
          ))}
        </div>
        <span className="text-xs text-white/50">{members.label}</span>
      </div>
    </>
  )
}
