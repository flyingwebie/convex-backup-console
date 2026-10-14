import path from 'node:path'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
}

function pair(idVar: string, secretVar: string) {
  const clientId = process.env[idVar]
  const clientSecret = process.env[secretVar]
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export const env = {
  dataDir: process.env.DATA_DIR ?? path.resolve('data'),
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  get masterKey() {
    return required('BACKUP_MASTER_KEY')
  },
  get authSecret() {
    return required('BETTER_AUTH_SECRET')
  },
  adminEmail: process.env.ADMIN_EMAIL,
  // Optional sign-in providers: each is enabled only when its client id + secret are set.
  oauth: {
    google: pair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    github: pair('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'),
    microsoft: pair('MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'),
  },
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID || 'common',
  // Convex Cloud's provisioning API, used to look up a deployment's URL from its deploy key.
  provisionHost: (process.env.CONVEX_PROVISION_HOST ?? 'https://api.convex.dev').replace(/\/+$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD,
}
