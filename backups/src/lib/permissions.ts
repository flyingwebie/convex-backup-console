// Workspace roles and what each may do. Shared by server checks and UI gating.
export const ROLES = ['owner', 'admin', 'operator', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Everything, including members, the encryption key and deleting the workspace.' },
  admin: { label: 'Admin', description: 'Manage instances, destinations, jobs, alerts and settings. Can restore.' },
  operator: { label: 'Operator', description: 'Run backups and download them. Cannot restore or change settings.' },
  viewer: { label: 'Viewer', description: 'Read-only: status, runs and audit log.' },
}

const ACTIONS = {
  view: ['owner', 'admin', 'operator', 'viewer'],
  run: ['owner', 'admin', 'operator'],
  download: ['owner', 'admin', 'operator'],
  manage: ['owner', 'admin'],
  restore: ['owner', 'admin'],
  settings: ['owner', 'admin'],
  members: ['owner'],
  encryptionKey: ['owner'],
  purge: ['owner'],
  deleteWorkspace: ['owner'],
} as const satisfies Record<string, readonly Role[]>
export type Action = keyof typeof ACTIONS

export function can(role: string | null | undefined, action: Action): boolean {
  return !!role && (ACTIONS[action] as readonly string[]).includes(role)
}
