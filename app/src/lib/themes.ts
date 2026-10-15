// Workspace colour themes. Each one recolours the primary accent (buttons, switches, focus rings,
// sidebar highlights); the palettes live in styles.css under [data-theme=…].
export const THEMES = ['neutral', 'blue', 'green', 'teal', 'violet', 'orange', 'rose'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_LABELS: Record<Theme, string> = {
  neutral: 'Neutral',
  blue: 'Blue',
  green: 'Green',
  teal: 'Teal',
  violet: 'Violet',
  orange: 'Orange',
  rose: 'Rose',
}

/** Swatch colour shown in the picker. */
export const THEME_SWATCH: Record<Theme, string> = {
  neutral: 'oklch(0.205 0 0)',
  blue: 'oklch(0.546 0.245 262.881)',
  green: 'oklch(0.627 0.194 149.214)',
  teal: 'oklch(0.6 0.118 184.704)',
  violet: 'oklch(0.541 0.281 293.009)',
  orange: 'oklch(0.646 0.222 41.116)',
  rose: 'oklch(0.586 0.253 17.585)',
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}
