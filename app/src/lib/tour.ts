import type { DriveStep } from 'driver.js'
import { can, type Role } from '~/lib/permissions'

// Product tour (driver.js): walks a new user through the sidebar in the order you set backups up —
// connect an instance → add storage → schedule a job → restore — then monitoring, settings and team.
// Targets are `data-tour` attributes in the sidebar. Steps whose target isn't on screen (the mobile
// sidebar is a closed sheet) are shown as a centred card instead.

type Step = { target?: string; title: string; body: string; show?: (role: Role, platformAdmin: boolean) => boolean }

const STEPS: Step[] = [
  {
    title: 'Welcome to Convex Backup Console 👋',
    body: 'A one-minute tour of how backups work here. Use the arrow keys or the buttons; you can replay it any time from your account menu.',
  },
  {
    target: 'workspace',
    title: 'Workspaces',
    body: 'Instances, storage, jobs and members all belong to a workspace, e.g. one per client or team. Switch between them here; your role is shown underneath.',
  },
  {
    target: 'nav-instances',
    title: '1 · Connect your Convex instances',
    body: 'Add each deployment you want to protect: a self-hosted URL with its admin key, or a Convex Cloud deploy key. Keys are encrypted at rest.',
  },
  {
    target: 'nav-destinations',
    title: '2 · Choose where backups go',
    body: 'S3-compatible buckets (Cloudflare R2, AWS S3, Backblaze B2, MinIO) or a local volume. Keep at least one copy off-site; turn on <strong>Object Lock</strong> to make backups ransomware-proof.',
  },
  {
    target: 'nav-jobs',
    title: '3 · Schedule a backup job',
    body: 'A job backs up one instance to one or more destinations on a schedule, with retention (daily / weekly / monthly) and encryption. Press <strong>Run</strong> to back up right now.',
  },
  {
    target: 'nav-runs',
    title: '4 · Download and restore',
    body: 'Every backup is listed here. Download it, see which tables and files it holds, or restore it: everything, selected tables only, or scrubbed into a staging instance. <strong>Test a restore before you need one.</strong>',
  },
  {
    target: 'nav-overview',
    title: 'Watch backup health',
    body: 'The overview shows the latest backup of every instance and flags anything failing or overdue.',
  },
  {
    target: 'nav-notifications',
    title: 'Get alerted',
    body: 'Send failures to Slack, Discord, Telegram, a webhook or email, so a broken backup never goes unnoticed. Email templates and recipients live under <strong>Emails</strong>.',
    show: (role) => can(role, 'manage'),
  },
  {
    target: 'nav-settings',
    title: 'Workspace settings',
    body: 'Job defaults, colour theme, deletion policy, API tokens and the <strong>encryption key</strong>. Download the private key and keep it somewhere safe: encrypted backups can’t be restored outside the console without it.',
    show: (role) => can(role, 'settings'),
  },
  {
    target: 'nav-members',
    title: 'Invite your team',
    body: 'Owners invite people as Owner, Admin, Operator (run and download) or Viewer (read-only).',
    show: (role) => can(role, 'members'),
  },
  {
    target: 'nav-trash',
    title: 'Deleted something?',
    body: 'Deleted instances, jobs and destinations wait in the Trash for a grace period, so you can restore them.',
  },
  {
    target: 'nav-platform',
    title: 'Platform administration',
    body: 'As a platform admin you create workspaces, manage users and set the platform email server and default templates.',
    show: (_role, platformAdmin) => platformAdmin,
  },
  {
    target: 'account',
    title: 'Your account',
    body: 'Two-factor, passkeys, signed-in sessions and light/dark mode. <strong>Take the tour</strong> here replays this guide. Happy backing up!',
  },
]

const visible = (selector: string) => {
  const el = document.querySelector(selector)
  return !!el && el.getClientRects().length > 0
}

export async function startTour({ role, platformAdmin, onFinish }: { role: Role | null; platformAdmin: boolean; onFinish?: () => void }) {
  const { driver } = await import('driver.js')
  const steps: DriveStep[] = STEPS.filter((s) => !s.show || (role !== null && s.show(role, platformAdmin))).map((s) => {
    const selector = s.target && `[data-tour="${s.target}"]`
    return {
      element: selector && visible(selector) ? selector : undefined,
      popover: { title: s.title, description: s.body, side: s.target === 'account' ? 'top' : 'right', align: 'start' },
    }
  })
  const tour = driver({
    steps,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Finish',
    popoverClass: 'cbc-tour',
    stagePadding: 4,
    stageRadius: 8,
    overlayOpacity: 0.55,
    // Highlighted sidebar links aren't clickable, so the tour can't navigate away mid-way.
    disableActiveInteraction: true,
    // Finish, close button, Escape or overlay click. (onDestroyed is skipped when the tour is closed
    // before a step's highlight animation completes, so this hook does the destroying itself.)
    onDestroyStarted: (_el, _step, { driver: d }) => {
      onFinish?.()
      d.destroy()
    },
  })
  tour.drive()
  return tour
}
