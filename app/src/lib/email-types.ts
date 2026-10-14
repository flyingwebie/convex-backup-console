// Email types: metadata, variables, sample data and default (structured) content.
// Shared by the server renderer and the template editor.

export type EmailType =
  | 'invitation'
  | 'member_role_changed'
  | 'member_removed'
  | 'backup_failed'
  | 'backup_partial'
  | 'backup_succeeded'
  | 'backup_stale'
  | 'restore_completed'
  | 'restore_failed'
  | 'digest'

export type SecurityEmailType = 'two_factor_reset' | 'passkey_added' | 'password_changed'

export type RoleKey = 'owner' | 'admin' | 'operator' | 'viewer'

export type Structured = {
  subject: string
  preheader: string
  heading: string
  /** Markdown with Liquid variables. */
  body: string
  buttonLabel: string
  /** Liquid expression for the button target, e.g. "{{ run.url }}". Empty hides the button. */
  buttonUrl: string
  /** Show the type's built-in details block (run copies, digest table…) under the body. */
  showDetails: boolean
}

export type VariableDoc = { name: string; description: string }

type Def = {
  label: string
  group: 'Team & access' | 'Backups' | 'Restores' | 'Reports'
  description: string
  /** Default recipients for a new workspace. */
  defaultRoute: { roles: RoleKey[]; actor: boolean; direct?: boolean }
  /** Supports "the person who did it". */
  hasActor: boolean
  /** Sent to one specific address (e.g. the invitee); routing doesn't apply. */
  direct?: boolean
  variables: VariableDoc[]
  sample: Record<string, unknown>
  defaults: Structured
}

const COMMON: VariableDoc[] = [
  { name: 'workspace.name', description: 'Workspace name' },
  { name: 'workspace.url', description: 'Link to the console' },
  { name: 'workspace.support_email', description: 'Support email (Branding)' },
  { name: 'recipient.name', description: "Recipient's name" },
  { name: 'recipient.email', description: "Recipient's email" },
]

const RUN_VARS: VariableDoc[] = [
  { name: 'job.name', description: 'Job name' },
  { name: 'instance.name', description: 'Instance name' },
  { name: 'instance.kind', description: '"self-hosted" or "cloud"' },
  { name: 'run.started_at', description: 'Start time (use | date)' },
  { name: 'run.duration', description: 'Human duration, e.g. "2m 14s"' },
  { name: 'run.bytes', description: 'Size in bytes (use | bytes)' },
  { name: 'run.error', description: 'Error message, if any' },
  { name: 'run.url', description: 'Link to the run' },
  { name: 'run.copies', description: 'List: destination, status, error' },
]

const sampleRun = {
  job: { name: 'Nightly production' },
  instance: { name: 'shop-prod', kind: 'cloud' },
  run: {
    started_at: '2026-10-14T03:00:12Z',
    duration: '2m 14s',
    bytes: 2_412_000_000,
    error: null as string | null,
    url: 'https://backups.example.com/runs',
    copies: [
      { destination: 'Cloudflare R2 · EU', status: 'ok', error: null },
      { destination: 'Backblaze B2 · immutable', status: 'ok', error: null },
    ],
  },
}

export const EMAIL_TYPES: Record<EmailType, Def> = {
  invitation: {
    label: 'Invitation',
    group: 'Team & access',
    description: 'Sent to someone invited to the workspace.',
    defaultRoute: { roles: [], actor: false, direct: true },
    hasActor: false,
    direct: true,
    variables: [
      { name: 'inviter.name', description: 'Who sent the invitation' },
      { name: 'inviter.email', description: "Inviter's email" },
      { name: 'invitation.role', description: 'Role offered' },
      { name: 'invitation.accept_url', description: 'Link to accept' },
      { name: 'invitation.expires_at', description: 'Expiry (use | date)' },
    ],
    sample: {
      inviter: { name: 'Maya Chen', email: 'maya@acme.dev' },
      invitation: { role: 'Operator', accept_url: 'https://backups.example.com/invite/abc123', expires_at: '2026-10-21T10:00:00Z' },
    },
    defaults: {
      subject: "You're invited to {{ workspace.name }}",
      preheader: '{{ inviter.name }} invited you to manage Convex backups.',
      heading: 'Join {{ workspace.name }}',
      body: '**{{ inviter.name }}** ({{ inviter.email }}) invited you to the **{{ workspace.name }}** workspace as **{{ invitation.role }}**.\n\nYou\'ll set a password (or use Google, GitHub or Microsoft) and a second factor when you accept.\n\nThis invitation expires on {{ invitation.expires_at | date: "%-d %B %Y" }}.',
      buttonLabel: 'Accept invitation',
      buttonUrl: '{{ invitation.accept_url }}',
      showDetails: false,
    },
  },
  member_role_changed: {
    label: 'Role changed',
    group: 'Team & access',
    description: "Sent to a member when their role changes.",
    defaultRoute: { roles: [], actor: false, direct: true },
    hasActor: false,
    direct: true,
    variables: [
      { name: 'member.old_role', description: 'Previous role' },
      { name: 'member.new_role', description: 'New role' },
      { name: 'actor.name', description: 'Who changed it' },
    ],
    sample: { member: { old_role: 'Viewer', new_role: 'Operator' }, actor: { name: 'Maya Chen' } },
    defaults: {
      subject: 'Your role in {{ workspace.name }} is now {{ member.new_role }}',
      preheader: '{{ actor.name }} changed your role.',
      heading: 'Your role changed',
      body: '{{ actor.name }} changed your role in **{{ workspace.name }}** from {{ member.old_role }} to **{{ member.new_role }}**.',
      buttonLabel: 'Open the console',
      buttonUrl: '{{ workspace.url }}',
      showDetails: false,
    },
  },
  member_removed: {
    label: 'Removed from workspace',
    group: 'Team & access',
    description: 'Sent to a member who was removed.',
    defaultRoute: { roles: [], actor: false, direct: true },
    hasActor: false,
    direct: true,
    variables: [{ name: 'actor.name', description: 'Who removed them' }],
    sample: { actor: { name: 'Maya Chen' } },
    defaults: {
      subject: 'You no longer have access to {{ workspace.name }}',
      preheader: 'Your access was removed.',
      heading: 'Access removed',
      body: '{{ actor.name }} removed you from **{{ workspace.name }}**. If you think this is a mistake, contact {{ workspace.support_email | default: "the workspace owner" }}.',
      buttonLabel: '',
      buttonUrl: '',
      showDetails: false,
    },
  },
  backup_failed: {
    label: 'Backup failed',
    group: 'Backups',
    description: 'A backup run failed on every destination or before upload.',
    defaultRoute: { roles: ['owner', 'admin'], actor: false },
    hasActor: false,
    variables: RUN_VARS,
    sample: { ...sampleRun, run: { ...sampleRun.run, error: 'Cannot reach https://crm-api.acme.dev: ECONNREFUSED', bytes: null, copies: [] } },
    defaults: {
      subject: '❌ Backup failed: {{ instance.name }}',
      preheader: '{{ run.error }}',
      heading: 'Backup of {{ instance.name }} failed',
      body: 'The job **{{ job.name }}** started at {{ run.started_at | date: "%-d %b %H:%M" }} and failed:\n\n> {{ run.error }}\n\nNo new backup was stored. The previous backups are untouched.',
      buttonLabel: 'View the run',
      buttonUrl: '{{ run.url }}',
      showDetails: true,
    },
  },
  backup_partial: {
    label: 'Backup partially failed',
    group: 'Backups',
    description: 'A backup was stored on some destinations but not all.',
    defaultRoute: { roles: ['owner', 'admin'], actor: false },
    hasActor: false,
    variables: RUN_VARS,
    sample: {
      ...sampleRun,
      run: { ...sampleRun.run, copies: [{ destination: 'Cloudflare R2 · EU', status: 'ok', error: null }, { destination: 'Backblaze B2 · immutable', status: 'failed', error: 'SlowDown: Please reduce your request rate.' }] },
    },
    defaults: {
      subject: '⚠️ Backup partially failed: {{ instance.name }}',
      preheader: 'Some destinations did not receive the backup.',
      heading: 'Backup of {{ instance.name }} partially failed',
      body: 'The job **{{ job.name }}** stored a {{ run.bytes | bytes }} backup, but not on every destination. Check the details below.',
      buttonLabel: 'View the run',
      buttonUrl: '{{ run.url }}',
      showDetails: true,
    },
  },
  backup_succeeded: {
    label: 'Backup succeeded',
    group: 'Backups',
    description: 'Every successful run. Off by default (it can be noisy).',
    defaultRoute: { roles: [], actor: false },
    hasActor: false,
    variables: RUN_VARS,
    sample: sampleRun,
    defaults: {
      subject: '✅ Backup completed: {{ instance.name }}',
      preheader: '{{ run.bytes | bytes }} stored in {{ run.duration }}.',
      heading: 'Backup of {{ instance.name }} completed',
      body: 'The job **{{ job.name }}** stored a {{ run.bytes | bytes }} backup in {{ run.duration }}.',
      buttonLabel: 'View the run',
      buttonUrl: '{{ run.url }}',
      showDetails: true,
    },
  },
  backup_stale: {
    label: 'No recent backup',
    group: 'Backups',
    description: "An instance hasn't had a good backup within the workspace's threshold.",
    defaultRoute: { roles: ['owner', 'admin'], actor: false },
    hasActor: false,
    variables: [
      { name: 'instance.name', description: 'Instance name' },
      { name: 'instance.last_good_backup', description: 'Last good backup (use | date), may be empty' },
      { name: 'stale_hours', description: 'Threshold in hours' },
    ],
    sample: { instance: { name: 'analytics', last_good_backup: '2026-10-11T04:00:00Z' }, stale_hours: 26 },
    defaults: {
      subject: '⏰ No recent backup: {{ instance.name }}',
      preheader: 'Nothing in the last {{ stale_hours }} hours.',
      heading: '{{ instance.name }} has no recent backup',
      body: "There hasn't been a successful backup of **{{ instance.name }}** in the last {{ stale_hours }} hours.\n\n{% if instance.last_good_backup %}The last good backup is from {{ instance.last_good_backup | date: \"%-d %b %H:%M\" }}.{% else %}It has never been backed up.{% endif %}\n\nCheck that its job is enabled and that the instance is reachable.",
      buttonLabel: 'Open the console',
      buttonUrl: '{{ workspace.url }}',
      showDetails: false,
    },
  },
  restore_completed: {
    label: 'Restore completed',
    group: 'Restores',
    description: 'A restore finished.',
    defaultRoute: { roles: ['owner'], actor: true },
    hasActor: true,
    variables: [
      { name: 'restore.target', description: 'Instance restored into' },
      { name: 'restore.mode', description: 'Full, replace, append…' },
      { name: 'restore.documents', description: 'Documents written' },
      { name: 'restore.tables', description: 'Tables (partial restores)' },
      { name: 'restore.scrubbed', description: 'true if personal data was scrubbed' },
      { name: 'restore.backup', description: 'Backup file' },
      { name: 'actor.name', description: 'Who started it' },
    ],
    sample: {
      restore: { target: 'shop-staging', mode: 'Full restore', documents: 2793452, tables: '', scrubbed: true, backup: 'shop-prod/2026-10-14T03-00-12Z.zip.age' },
      actor: { name: 'Maya Chen' },
    },
    defaults: {
      subject: '✅ Restore into {{ restore.target }} completed',
      preheader: '{{ restore.documents }} documents restored.',
      heading: '{{ restore.target }} was restored',
      body: '{{ actor.name }} restored **{{ restore.target }}** ({{ restore.mode }}{% if restore.tables != blank %}: {{ restore.tables }}{% endif %}). {{ restore.documents }} documents were written{% if restore.scrubbed %}, with personal data scrubbed{% endif %}.\n\nBackup: `{{ restore.backup }}`',
      buttonLabel: 'View restores',
      buttonUrl: '{{ workspace.url }}/runs?tab=restores',
      showDetails: false,
    },
  },
  restore_failed: {
    label: 'Restore failed',
    group: 'Restores',
    description: 'A restore failed.',
    defaultRoute: { roles: ['owner', 'admin'], actor: true },
    hasActor: true,
    variables: [
      { name: 'restore.target', description: 'Instance restored into' },
      { name: 'restore.error', description: 'Error message' },
      { name: 'restore.backup', description: 'Backup file' },
      { name: 'actor.name', description: 'Who started it' },
    ],
    sample: { restore: { target: 'shop-staging', error: 'Table _storage already exists.', backup: 'shop-prod/2026-10-14T03-00-12Z.zip.age' }, actor: { name: 'Maya Chen' } },
    defaults: {
      subject: '❌ Restore into {{ restore.target }} failed',
      preheader: '{{ restore.error }}',
      heading: 'Restore into {{ restore.target }} failed',
      body: 'The restore started by {{ actor.name }} failed:\n\n> {{ restore.error }}\n\nConvex rejects a failing import as a whole, so {{ restore.target }} should be unchanged.',
      buttonLabel: 'View restores',
      buttonUrl: '{{ workspace.url }}/runs?tab=restores',
      showDetails: false,
    },
  },
  digest: {
    label: 'Daily / weekly digest',
    group: 'Reports',
    description: 'Summary of runs, failures and instance health (schedule in Workspace settings).',
    defaultRoute: { roles: ['owner'], actor: false },
    hasActor: false,
    variables: [
      { name: 'period', description: '"daily" or "weekly"' },
      { name: 'since', description: 'Start of the period (use | date)' },
      { name: 'runs.total', description: 'Runs in the period' },
      { name: 'runs.ok', description: 'Successful runs' },
      { name: 'runs.failed', description: 'Failed runs' },
      { name: 'runs.bytes', description: 'Data backed up (use | bytes)' },
      { name: 'restores', description: 'Restores in the period' },
      { name: 'healthy', description: 'true if every instance is healthy' },
      { name: 'instances', description: 'List: name, healthy, last_good_backup, protected' },
      { name: 'failures', description: 'List: instance, error' },
    ],
    sample: {
      period: 'daily',
      since: '2026-10-13T08:00:00Z',
      runs: { total: 6, ok: 5, partial: 0, failed: 1, bytes: 9_800_000_000 },
      restores: 1,
      healthy: false,
      instances: [
        { name: 'shop-prod', healthy: true, last_good_backup: '2026-10-14T03:02:00Z', protected: true },
        { name: 'crm-prod', healthy: false, last_good_backup: '2026-10-12T02:01:00Z', protected: true },
        { name: 'analytics', healthy: true, last_good_backup: '2026-10-13T04:05:00Z', protected: true },
      ],
      failures: [{ instance: 'crm-prod', error: 'Cannot reach https://crm-api.acme.dev: ECONNREFUSED' }],
    },
    defaults: {
      subject: '{% if healthy %}✅{% else %}⚠️{% endif %} {{ workspace.name }} backup digest',
      preheader: '{{ runs.ok }} ok, {{ runs.failed }} failed · {{ runs.bytes | bytes }} backed up',
      heading: 'Your {{ period }} backup digest',
      body: 'Since {{ since | date: "%-d %b %H:%M" }}: **{{ runs.total }}** runs ({{ runs.ok }} ok, {{ runs.failed }} failed), **{{ runs.bytes | bytes }}** backed up and {{ restores }} restore(s).{% unless healthy %}\n\n**Some instances need attention** — see below.{% endunless %}',
      buttonLabel: 'Open the console',
      buttonUrl: '{{ workspace.url }}',
      showDetails: true,
    },
  },
}

export const EMAIL_TYPE_KEYS = Object.keys(EMAIL_TYPES) as EmailType[]
export const COMMON_VARIABLES = COMMON

export const COMMON_SAMPLE = {
  workspace: { name: 'Acme Agency', url: 'https://backups.example.com', support_email: 'support@acme.dev' },
  recipient: { name: 'Davide Rossi', email: 'davide@acme.dev' },
}
