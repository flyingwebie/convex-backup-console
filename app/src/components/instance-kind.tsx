import { Cloud, Server } from 'lucide-react'
import { Badge } from '~/components/ui/badge'

export function InstanceKindBadge({ kind, type }: { kind: 'self_hosted' | 'cloud'; type?: string | null }) {
  return kind === 'cloud' ? (
    <Badge variant="secondary" className="gap-1">
      <Cloud className="size-3" /> Cloud{type ? ` · ${type}` : ''}
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1">
      <Server className="size-3" /> Self-hosted
    </Badge>
  )
}
