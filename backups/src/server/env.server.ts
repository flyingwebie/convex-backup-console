import path from 'node:path'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
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
  // Convex Cloud's provisioning API, used to look up a deployment's URL from its deploy key.
  provisionHost: (process.env.CONVEX_PROVISION_HOST ?? 'https://api.convex.dev').replace(/\/+$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD,
}
