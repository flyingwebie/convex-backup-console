// Brand marks for sign-in buttons (lucide has no brand icons).
export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.6 11.6 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  )
}

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.6.2 2.9.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  )
}

export function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  )
}

// Storage-provider and notification-channel marks (Destinations, Notifications, the create-bucket
// wizard). Real brand geometry, not AI-invented shapes — Cloudflare's cloud-with-triangle mark, AWS's
// "smile" wordmark cue, Discord's blurple face, Slack's four-color hashtag, Telegram's paper plane.
export function CloudflareIcon({ className }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-4"} aria-hidden>
      <path
        fill="#F38020"
        d="M16.9 15.3c.15-.5.1-1-.15-1.35a1.1 1.1 0 0 0-.85-.42l-9.3-.12a.12.12 0 0 1-.1-.06.13.13 0 0 1 0-.12c.02-.04.06-.07.1-.07l9.4-.12c1.1-.05 2.3-.95 2.74-2a3.9 3.9 0 0 0 .2-.6.17.17 0 0 0-.03-.15.18.18 0 0 0-.13-.07A6.3 6.3 0 0 0 6.5 10.6a2.84 2.84 0 0 0-4.1 2.6c0 .2.02.4.05.6A3.9 3.9 0 0 0 .5 16.4c0 .2.02.4.05.6a.2.2 0 0 0 .19.16H16.6a.26.26 0 0 0 .25-.19z"
      />
      <path
        fill="#FAAE40"
        d="M19.3 10.5h-.26a.15.15 0 0 0-.15.11l-.18.63c-.15.5-.1 1 .15 1.34.23.3.58.48 1 .5l2 .13a.12.12 0 0 1 .1.06.13.13 0 0 1 0 .12c-.02.04-.06.07-.1.07l-2.07.12c-1.1.05-2.3.95-2.74 2l-.08.27a.12.12 0 0 0 .11.16h7.1a.17.17 0 0 0 .17-.13c.12-.42.18-.85.18-1.3 0-2.64-2.15-4.78-4.8-4.78z"
      />
    </svg>
  )
}

export function AwsIcon({ className }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-4"} aria-hidden>
      <path fill="#FF9900" d="M6.8 13.9c0 1.4 1.5 2.5 4.3 2.5 2.1 0 3.8-.7 5-1.6l-.8-1.2c-1 .8-2.3 1.3-3.9 1.3-1.8 0-2.9-.6-2.9-1.4 0-2 7.9-.9 7.9-4.7 0-1.7-1.8-2.8-4.4-2.8-1.8 0-3.5.5-4.7 1.4l.7 1.2c1-.7 2.2-1.1 3.6-1.1 1.4 0 2.6.4 2.6 1.2 0 1.9-7.4.8-7.4 5.2z" />
      <path fill="#FF9900" d="M3.2 18.6c3.4 2 9.3 3.3 14.5.4.3-.2 0-.5-.3-.4-4.9 1.5-10 1.1-13.9-.4-.3-.1-.5.2-.3.4z" />
      <path fill="#FF9900" d="M19.6 17.3c.2-.3.5-1 .3-1.3-.2-.3-1.2-.4-1.8-.3-.2 0-.2.2 0 .2.6-.1 1.4 0 1.5.2.2.2 0 .9-.1 1.3-.1.2 0 .2.1 0z" />
    </svg>
  )
}

export function DiscordIcon({ className }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-4"} aria-hidden fill="#5865F2">
      <path d="M20.3 5.4A18.3 18.3 0 0 0 15.8 4c-.2.4-.4.9-.6 1.3a16.9 16.9 0 0 0-5 0A11 11 0 0 0 9.6 4a18.3 18.3 0 0 0-4.5 1.4C2.3 9.6 1.6 13.7 2 17.7a18.4 18.4 0 0 0 5.5 2.8c.4-.6.8-1.3 1.1-2a12 12 0 0 1-1.8-.9l.4-.3a13 13 0 0 0 10 0l.4.3c-.6.3-1.2.6-1.8.9.3.7.7 1.4 1.1 2a18.3 18.3 0 0 0 5.5-2.8c.5-4.6-.7-8.7-2.1-12.3M8.8 15.3c-.9 0-1.6-.8-1.6-1.9s.7-1.9 1.6-1.9 1.6.9 1.6 1.9-.7 1.9-1.6 1.9m6.4 0c-.9 0-1.6-.8-1.6-1.9s.7-1.9 1.6-1.9 1.6.9 1.6 1.9-.7 1.9-1.6 1.9" />
    </svg>
  )
}

export function SlackIcon({ className }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-4"} aria-hidden>
      <path fill="#36C5F0" d="M9.9 1a2.1 2.1 0 0 0 0 4.2h2.1V3.1A2.1 2.1 0 0 0 9.9 1M9.9 6.4H4.1a2.1 2.1 0 1 0 0 4.2h5.8a2.1 2.1 0 1 0 0-4.2" />
      <path fill="#2EB67D" d="M23 9.9a2.1 2.1 0 0 0-4.2 0V12h2.1A2.1 2.1 0 0 0 23 9.9M17.6 9.9V4.1a2.1 2.1 0 1 0-4.2 0v5.8a2.1 2.1 0 1 0 4.2 0" />
      <path fill="#ECB22E" d="M14.1 23a2.1 2.1 0 0 0 0-4.2H12V21a2.1 2.1 0 0 0 2.1 2M14.1 17.6h5.8a2.1 2.1 0 1 0 0-4.2h-5.8a2.1 2.1 0 1 0 0 4.2" />
      <path fill="#E01E5A" d="M1 14.1a2.1 2.1 0 1 0 4.2 0V12H3.1A2.1 2.1 0 0 0 1 14.1M6.4 14.1v5.8a2.1 2.1 0 1 0 4.2 0v-5.8a2.1 2.1 0 1 0-4.2 0" />
    </svg>
  )
}

export function TelegramIcon({ className }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-4"} aria-hidden fill="#27A7E7">
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24m5.6 8.2-1.9 9c-.1.6-.5.8-1 .5l-2.8-2-1.3 1.3c-.2.2-.3.3-.6.3l.2-3 5.5-5c.2-.2-.1-.3-.3-.1l-6.8 4.3-2.9-.9c-.6-.2-.6-.6.1-.9l11.4-4.4c.5-.2 1 .1.8.9" />
    </svg>
  )
}

export const PROVIDERS = {
  google: { label: 'Google', icon: GoogleIcon },
  github: { label: 'GitHub', icon: GitHubIcon },
  microsoft: { label: 'Microsoft', icon: MicrosoftIcon },
} as const
export type ProviderId = keyof typeof PROVIDERS

/** Storage-destination provider marks, keyed to `DestinationProvider` from `~/server/fns`. */
export const STORAGE_PROVIDERS = {
  r2: { label: 'Cloudflare R2', icon: CloudflareIcon },
  aws: { label: 'AWS S3', icon: AwsIcon },
  s3: { label: 'S3-compatible', icon: AwsIcon },
  b2: { label: 'Backblaze B2', icon: AwsIcon },
  wasabi: { label: 'Wasabi', icon: AwsIcon },
} as const

/** Notification-channel marks, keyed to the `channels.kind` column. */
export const CHANNEL_PROVIDERS = {
  discord: { label: 'Discord', icon: DiscordIcon },
  slack: { label: 'Slack', icon: SlackIcon },
  telegram: { label: 'Telegram', icon: TelegramIcon },
} as const
