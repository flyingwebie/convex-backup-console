// End-to-end test of the backup console UI against the local Docker kit (see ../README.md).
// Usage: CONSOLE_URL=http://localhost:3090 A_KEY=… B_KEY=… node e2e.mjs
import { execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`Missing ${k}`) })()
const URL_ = env('CONSOLE_URL', 'http://localhost:3090')
const EMAIL = env('ADMIN_EMAIL', 'e2e@example.com')
const PASSWORD = env('ADMIN_PASSWORD', 'e2e-password-123456')
const HOOK_PATH = `/e2e-${Date.now()}`
const shots = new URL('./screenshots/', import.meta.url).pathname
mkdirSync(shots, { recursive: true })

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

let step = 0
const ok = (msg) => console.log(`✔ ${String(++step).padStart(2)} ${msg}`)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } })
const shot = (name) => page.screenshot({ path: `${shots}${name}.png`, fullPage: true })
const dialog = () => page.getByRole('dialog')
const pick = async (combobox, option) => {
  await combobox.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

try {
  // ── Auth ──
  await page.goto(`${URL_}/`)
  await page.waitForURL(/\/login/)
  await shot('01-login')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill('wrong-password-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText(/invalid/i).waitFor()
  ok('wrong password is rejected')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/security/)
  ok('login forces 2FA enrolment')
  await page.getByLabel('Confirm your password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue' }).click()
  const secret = (await page.locator('p code').first().textContent()).trim()
  await shot('02-2fa-enrol')
  await page.locator('input[autocomplete="one-time-code"], [data-input-otp]').first().fill(totp(secret))
  await page.waitForURL(`${URL_}/`)
  await page.getByText("Let's protect your first Convex instance").waitFor()
  ok('TOTP enrolled; empty-state overview shown')
  await shot('03-overview-empty')

  // ── Instances ──
  await page.getByRole('link', { name: 'Instances' }).click()
  for (const [name, url, key] of [
    ['convex-a', env('A_URL', 'http://host.docker.internal:3301'), env('A_KEY')],
    ['convex-b', env('B_URL', 'http://host.docker.internal:3302'), env('B_KEY')],
  ]) {
    await page.getByRole('button', { name: 'Add instance' }).first().click()
    await dialog().getByLabel('Name').fill(name)
    await dialog().getByLabel('API URL').fill(url)
    await dialog().getByLabel('Admin key').fill(key)
    await dialog().getByRole('button', { name: 'Connect' }).click()
    await page.getByRole('cell', { name, exact: true }).waitFor()
  }
  ok('added instances A and B (connection verified)')
  await shot('04-instances')

  // ── Destinations ──
  await page.getByRole('link', { name: 'Destinations' }).click()
  await page.getByRole('button', { name: 'Add destination' }).first().click()
  await dialog().getByLabel('Name').fill('fake-r2')
  await dialog().getByLabel('Endpoint').fill(env('R2_ENDPOINT', 'http://cbc-r2:9000'))
  await dialog().getByLabel('Bucket').fill(env('R2_BUCKET', 'convex-backups-test'))
  await dialog().getByLabel('Region').fill('us-east-1')
  await dialog().getByLabel('Folder prefix').fill('e2e')
  await dialog().getByLabel('Access key ID').fill(env('R2_KEY', 'r2key'))
  await dialog().getByLabel('Secret access key').fill(env('R2_SECRET', 'r2-secret-key'))
  await dialog().getByLabel(/Path-style/).check()
  await dialog().getByRole('button', { name: 'Add destination' }).click()
  await page.getByRole('cell', { name: 'fake-r2', exact: true }).waitFor()
  ok('added S3 destination (access verified)')
  await shot('05-destinations')

  // ── Encryption key ──
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Create encryption key' }).click()
  const identity = (await dialog().locator('pre').textContent()).trim()
  if (!identity.startsWith('AGE-SECRET-KEY-1')) throw new Error('No age identity shown')
  await shot('06-encryption-key')
  await dialog().getByRole('button', { name: "I've saved it" }).click()
  ok('created age encryption key')

  // ── Notifications ──
  await page.getByRole('link', { name: 'Notifications' }).click()
  await page.getByRole('button', { name: 'Add channel' }).first().click()
  await pick(dialog().getByRole('combobox'), 'Generic webhook')
  await dialog().getByLabel('Webhook URL').fill(`${env('HOOK_BASE', 'http://cbc-hook:8080')}${HOOK_PATH}`)
  await dialog().getByRole('button', { name: 'Add channel' }).click()
  await page.getByRole('button', { name: 'Test' }).click()
  await page.getByText(/Test sent to/).waitFor()
  ok('added webhook channel and sent a test')
  await shot('07-notifications')

  // ── Job ──
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  await dialog().getByLabel('Name').fill('e2e-encrypted')
  await pick(dialog().getByRole('combobox').nth(1), 'Manual only')
  if (!(await dialog().getByRole('switch', { name: /Encrypt/ }).isChecked())) throw new Error('Encryption should default on')
  await shot('08-job-dialog')
  await dialog().getByRole('button', { name: 'Create job' }).click()
  await page.getByRole('cell', { name: /e2e-encrypted/ }).waitFor()
  ok('created encrypted job with recommended retention (7 daily / 4 weekly / 12 monthly)')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByText(/e2e-encrypted started/).waitFor()

  // ── Run ──
  await page.getByRole('link', { name: 'Runs & restores' }).click()
  await page.getByRole('button', { name: 'Use backup' }).first().waitFor({ timeout: 120_000 })
  ok('backup run succeeded (live refresh picked it up)')
  await shot('09-runs')

  // ── Download (decrypted) ──
  await page.getByRole('button', { name: 'Use backup' }).first().click()
  const href = await page.getByRole('menuitem', { name: 'Download zip' }).getAttribute('href')
  const zip = await page.request.get(`${URL_}${href}`)
  const body = await zip.body()
  if (zip.status() !== 200 || body.subarray(0, 2).toString() !== 'PK') throw new Error(`Bad download ${zip.status()}`)
  const raw = await page.request.get(`${URL_}${href}&raw=1`)
  if (!(await raw.body()).subarray(0, 21).toString().startsWith('age-encryption.org/v1')) throw new Error('Raw download is not age')
  ok(`downloaded decrypted zip (${(body.length / 1024 / 1024).toFixed(1)} MB) and raw .age`)

  // ── Restore guard: requireEmpty into non-empty B must fail ──
  await page.getByRole('menuitem', { name: 'Restore…' }).click()
  await pick(dialog().getByRole('combobox').nth(0), 'convex-b')
  await pick(dialog().getByRole('combobox').nth(1), 'Only into an empty instance')
  const submit = dialog().getByRole('button', { name: /Restore into convex-b/ })
  await dialog().getByLabel(/to confirm/).fill('convex-a')
  if (await submit.isEnabled()) throw new Error('Restore enabled with wrong confirmation')
  await dialog().getByLabel(/to confirm/).fill('convex-b')
  await shot('10-restore-dialog')
  await submit.click()
  await page.getByRole('tab', { name: /Restores/, selected: true }).waitFor()
  await page.getByRole('cell').getByText('Failed').first().waitFor({ timeout: 120_000 })
  ok('restore into a non-empty instance is refused (requireEmpty)')
  await shot('11-restores')

  const hook = execSync('docker logs cbc-hook 2>&1').toString().split('\n').filter((l) => l.includes(HOOK_PATH))
  const events = hook.map((l) => JSON.parse(JSON.parse(l).body))
  if (!events.some((e) => e.type === 'test')) throw new Error('No test notification received')
  if (!events.some((e) => e.type === 'restore' && e.status === 'failed')) throw new Error('No restore-failed notification received')
  ok(`webhook received: ${events.map((e) => `${e.type}/${e.status}`).join(', ')}`)

  // ── Overview + audit ──
  await page.getByRole('link', { name: 'Overview' }).click()
  await page.getByText('Recent activity').waitFor()
  await shot('12-overview')
  await page.getByRole('link', { name: 'Audit log' }).click()
  await page.getByText('restore.failed').first().waitFor()
  await shot('13-audit')
  ok('overview and audit log reflect the activity')
  console.log(`\nAll ${step} checks passed. Screenshots: ${shots}`)
} catch (err) {
  await shot('FAILED').catch(() => {})
  console.error(`✘ step ${step + 1} failed:`, err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
