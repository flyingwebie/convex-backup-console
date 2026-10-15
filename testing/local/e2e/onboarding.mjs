// First-run setup wizard on a brand-new console (no ADMIN_EMAIL): setup code from the logs,
// admin account, TOTP, first workspace with logo + timezone, team invitations by email.
// Usage: node onboarding.mjs   (starts container cbc-onboard on :3091, removes it afterwards)
import { execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { chromium } from 'playwright'

const NAME = 'cbc-onboard'
const URL_ = 'http://localhost:3091'
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025'
const shots = new URL('./screenshots/', import.meta.url).pathname
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function totp(secret) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret].map((c) => a.indexOf(c).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const ctr = Buffer.alloc(8)
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(ctr).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}
const dbGet = (q) =>
  JSON.parse(execSync(`docker exec -i ${NAME} node -`, { input: `const d=require('/app/node_modules/better-sqlite3')('/data/console.db');console.log(JSON.stringify(d.prepare(${JSON.stringify(q)}).get() ?? null))` }).toString())

let step = 0
const ok = (m) => console.log(`✔ ${String(++step).padStart(2)} ${m}`)
const LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f766e"/><path d="M16 44 32 16l16 28z" fill="#fff"/></svg>')

sh(`docker rm -f ${NAME} 2>/dev/null; docker volume rm ${NAME}-vol 2>/dev/null || true`)
sh(`docker run -d --name ${NAME} --network cbc-net --read-only --tmpfs /tmp -v ${NAME}-vol:/data -p 3091:3000 \
  -e PUBLIC_URL=${URL_} -e BACKUP_MASTER_KEY=onboard-master-key -e BETTER_AUTH_SECRET=onboard-secret-0123456789abcdefghijkl cbc-test`)
for (let i = 0; i < 60; i++) {
  if (await fetch(`${URL_}/api/health`).then((r) => r.ok, () => false)) break
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const shot = (n) => page.screenshot({ path: `${shots}${n}.png`, fullPage: true })
try {
  // Any page sends an unclaimed console to /setup
  await page.goto(`${URL_}/`)
  await page.waitForURL(/\/setup$/)
  await page.locator('fieldset[data-hydrated="true"]').waitFor()
  const code = sh(`docker logs ${NAME}`).match(/\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/)?.[1]
  if (!code) throw new Error('No setup code in the logs')
  await shot('40-setup-account')
  ok(`unclaimed console redirects to /setup; setup code ${code} printed in the logs`)

  // Wrong code is refused and nothing is created
  const fill = async (c) => {
    await page.getByLabel('Setup code').fill(c)
    await page.getByLabel('Your name').fill('Davide')
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password', { exact: true }).fill('a-very-long-password')
    await page.getByLabel('Confirm password').fill('a-very-long-password')
    await page.getByRole('button', { name: 'Create admin account' }).click()
  }
  await fill('AAAA-BBBB-CCCC')
  await page.getByText("That setup code isn't right").waitFor()
  if (dbGet('SELECT COUNT(*) AS n FROM user').n !== 0) throw new Error('User created with a wrong code')
  ok('wrong setup code refused; no account created')

  // Right code (lowercase, no dashes also works) → account → 2FA step
  await fill(code.toLowerCase().replaceAll('-', ''))
  await page.waitForURL(/\/security$/)
  await page.getByRole('list', { name: 'Setup progress' }).waitFor()
  if (dbGet("SELECT role FROM user WHERE email = 'owner@example.com'").role !== 'admin') throw new Error('Not a platform admin')
  ok('setup code accepted; platform admin created and signed in; wizard continues on the 2FA step')

  // The code is single use
  const again = await fetch(`${URL_}/setup`).then((r) => r.url)
  if (dbGet("SELECT value FROM settings WHERE key = 'setup_code_enc'").value !== '') throw new Error('Setup code not cleared')
  ok(`setup code cleared after use (fresh visitor to /setup lands on ${new URL(again).pathname})`)

  await page.locator('fieldset[data-hydrated="true"]').waitFor()
  await page.getByLabel('Confirm your password').fill('a-very-long-password')
  await page.getByRole('button', { name: 'Continue' }).click()
  const secret = (await page.locator('p code').first().textContent()).trim()
  await page.locator('input[autocomplete="one-time-code"], [data-input-otp]').first().fill(totp(secret))
  await page.waitForURL(/\/setup$/)
  await page.getByText('Create your first workspace').waitFor()
  ok('TOTP enrolled → back in the wizard at "Create your first workspace" (no "Default" workspace created)')

  await page.getByLabel('Workspace name').fill('Acme Agency')
  if ((await page.getByLabel('Slug').inputValue()) !== 'acme-agency') throw new Error('Slug not derived')
  await page.getByLabel('Workspace logo').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: LOGO })
  await page.getByRole('combobox', { name: 'Timezone' }).click()
  await page.getByRole('option', { name: 'Europe/Dublin', exact: true }).click()
  await shot('41-setup-workspace')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByText('Invite your team to Acme Agency').waitFor()
  const ws = dbGet("SELECT o.id, o.logo, s.timezone FROM organization o JOIN workspace_settings s ON s.workspace_id = o.id WHERE o.slug = 'acme-agency'")
  if (!ws?.logo?.startsWith('/api/logo/') || ws.timezone !== 'Europe/Dublin') throw new Error(`Workspace not set up: ${JSON.stringify(ws)}`)
  ok('workspace created with name, slug, logo and timezone')

  // Team: set up SMTP inline, invite two people
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })
  await page.getByRole('button', { name: 'Set up email' }).click()
  await page.getByLabel('Host', { exact: true }).fill('cbc-mail')
  await page.getByLabel('Port', { exact: true }).fill('1025')
  await page.getByLabel('From', { exact: true }).fill('Acme Backups <backups@acme.dev>')
  await page.getByRole('button', { name: 'Save and send a test' }).click()
  await page.getByText('Email works').waitFor()
  await page.getByLabel('Email 1').fill('maya@acme.dev')
  await page.getByRole('button', { name: 'Add another' }).click()
  await page.getByLabel('Email 2').fill('client@example.com')
  await page.getByRole('combobox', { name: 'Role 2' }).click()
  await page.getByRole('option', { name: 'Viewer', exact: true }).click()
  await page.getByRole('button', { name: 'Send invitations' }).click()
  await page.getByText('client@example.com').waitFor()
  await shot('42-setup-team')
  const inv = (e) => dbGet(`SELECT role FROM invitation WHERE email = '${e}' AND status = 'pending'`)?.role
  if (inv('maya@acme.dev') !== 'admin' || inv('client@example.com') !== 'viewer') throw new Error('Invitations missing or wrong roles')
  let subjects = []
  for (let i = 0; i < 20 && subjects.filter((s) => s.includes('Acme Agency')).length < 2; i++) {
    subjects = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()).messages.map((m) => m.Subject)
    await page.waitForTimeout(250)
  }
  if (subjects.filter((s) => /invited to Acme Agency/.test(s)).length !== 2) throw new Error(`Invitation emails: ${subjects}`)
  ok('SMTP set up inside the wizard; Admin + Viewer invitations emailed')

  await page.getByRole('button', { name: 'Finish' }).click()
  await page.waitForURL(`${URL_}/`)
  await page.getByRole('heading', { name: 'Overview' }).first().waitFor()
  await page.locator('.driver-popover').getByText('Welcome to Convex Backup Console').waitFor()
  await page.keyboard.press('Escape')
  if (dbGet("SELECT value FROM settings WHERE key = 'onboarding'").value !== 'done') throw new Error('Onboarding not marked done')
  await page.goto(`${URL_}/setup`)
  await page.waitForURL(`${URL_}/`)
  ok('finished → Overview with the product tour; /setup now redirects home')

  console.log(`\nAll ${step} onboarding checks passed.`)
} catch (err) {
  await shot('FAILED-onboarding').catch(() => {})
  console.error(`✘ step ${step + 1} failed:`, err.message)
  process.exitCode = 1
} finally {
  await browser.close()
  if (!process.env.KEEP) sh(`docker rm -f ${NAME}; docker volume rm ${NAME}-vol`)
}
