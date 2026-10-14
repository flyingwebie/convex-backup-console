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
  adminPassword: process.env.ADMIN_PASSWORD,
}
