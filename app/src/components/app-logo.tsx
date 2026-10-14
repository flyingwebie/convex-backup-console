import { useId } from 'react'
import { cn } from '~/lib/utils'

/** The Convex Backup Console mark: a restore arrow around a database with the restored snapshot in amber. */
export function AppLogo({ className, title = 'Convex Backup Console' }: { className?: string; title?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={cn('size-8 shrink-0', className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="8" y1="2" x2="56" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7C7FF7" />
          <stop offset=".5" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#2E2A85" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="32" y1="0" x2="32" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".25" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id}-bg)`} />
      <rect width="64" height="64" rx="15" fill={`url(#${id}-shine)`} />
      <path d="M15.04 21.40A20 20 0 1 1 14.68 42.00" fill="none" stroke="#fff" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M11.89 26.45L11.64 16.27L21.14 22.21Z" fill="#fff" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <ellipse cx="32" cy="22.6" rx="8.5" ry="3.4" fill="#fff" />
      <path d="M23.5 22.6A8.5 3.4 0 0 0 40.5 22.6V27.3A8.5 3.4 0 0 1 23.5 27.3Z" fill="#fff" fillOpacity=".8" />
      <path d="M23.5 28.8A8.5 3.4 0 0 0 40.5 28.8V33.5A8.5 3.4 0 0 1 23.5 33.5Z" fill="#FBBF24" />
      <path d="M23.5 35.0A8.5 3.4 0 0 0 40.5 35.0V41.2A8.5 3.4 0 0 1 23.5 41.2Z" fill="#fff" />
    </svg>
  )
}
