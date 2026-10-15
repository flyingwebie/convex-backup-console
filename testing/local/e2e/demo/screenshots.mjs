// Captures product screenshots from a console seeded with demo data (see seed-demo.cjs).
import { execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import { chromium } from 'playwright'

const URL_ = 'http://localhost:3100'
const OUT = new URL('../../../../docs/images/screens/', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })
const MASTER = 'demo-master-key-0123456789'

execSync('docker rm -f cbc-demo >/dev/null 2>&1; docker volume rm cbc-demo-vol >/dev/null 2>&1; true', { shell: '/bin/bash' })
execSync(
  `docker run -d --name cbc-demo -p 3100:3000 --read-only --tmpfs /tmp -v cbc-demo-vol:/data -e BACKUP_MASTER_KEY=${MASTER} -e BETTER_AUTH_SECRET=demo-secret-0123456789abcdefghijklmn -e PUBLIC_URL=${URL_} -e ADMIN_EMAIL=davide@acme.dev -e ADMIN_PASSWORD=demo-password-123 -e GOOGLE_CLIENT_ID=demo -e GOOGLE_CLIENT_SECRET=demo -e GITHUB_CLIENT_ID=demo -e GITHUB_CLIENT_SECRET=demo -e MICROSOFT_CLIENT_ID=demo -e MICROSOFT_CLIENT_SECRET=demo cbc-test`,
)
for (let i = 0; i < 60; i++) {
  try {
    execSync(`curl -sf ${URL_}/api/health`)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 1000))
  }
}

function totp(secret) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret].map((c) => a.indexOf(c).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const ctr = Buffer.alloc(8)
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(ctr).digest()
  return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1e6).padStart(6, '0')
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const shot = async (name, opts = {}) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}${name}.png`, ...opts })
  console.log('📸', name)
}

// Login page (with providers), then sign in + enrol TOTP
await page.goto(`${URL_}/login`)
await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
await shot('login')
await page.getByLabel('Email').fill('davide@acme.dev')
await page.getByLabel('Password').fill('demo-password-123')
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.waitForURL(/security/)
await page.getByLabel('Confirm your password').fill('demo-password-123')
await page.getByRole('button', { name: 'Continue' }).click()
const secret = (await page.locator('p code').first().textContent()).trim()
await page.locator('[data-input-otp]').first().fill(totp(secret))
await page.waitForURL(`${URL_}/`)

// Seed demo data, then logo
execSync(`docker exec -i -e MASTER_KEY=${MASTER} cbc-demo node -`, { input: fs.readFileSync(new URL('./seed-demo.cjs', import.meta.url)) , stdio: ['pipe', 'inherit', 'inherit'] })
await page.goto(`${URL_}/workspace`)
await page.locator('input[type="file"]').setInputFiles({ name: 'acme.svg', mimeType: 'image/svg+xml', buffer: fs.readFileSync(new URL('./acme-logo.svg', import.meta.url)) })
await page.getByText('Logo updated').waitFor()
await page.waitForTimeout(4500) // let toasts fade

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => localStorage.setItem('theme', t), theme)
  const suffix = theme === 'dark' ? '-dark' : ''
  await page.goto(`${URL_}/`)
  await page.getByText('Recent activity').waitFor()
  await shot(`overview${suffix}`)
  await page.goto(`${URL_}/storage`)
  await page.locator('.recharts-surface').first().waitFor()
  await shot(`storage${suffix}`)
  await page.goto(`${URL_}/runs`)
  await page.getByRole('button', { name: 'Contents' }).first().waitFor()
  await shot(`runs${suffix}`)
  await page.getByRole('button', { name: 'Contents' }).first().click()
  await page.getByRole('dialog').getByText('Changes compared with').waitFor()
  await page.waitForTimeout(600)
  await shot(`contents${suffix}`)
  await page.keyboard.press('Escape')
  if (theme === 'dark') break
  await page.getByRole('row', { name: /shop-prod/ }).first().getByRole('button', { name: 'Use backup' }).click()
  await page.getByRole('menuitem', { name: 'Restore…' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('combobox').nth(0).click()
  await page.getByRole('option', { name: /shop-staging/ }).click()
  await dlg.getByRole('switch', { name: /Scrub personal data/ }).click()
  await dlg.getByLabel(/to confirm/).fill('shop-staging')
  await page.waitForTimeout(500)
  await shot('restore')
  await page.keyboard.press('Escape')
  for (const [path, name, wait] of [
    ['/instances', 'instances', 'shop-prod'],
    ['/destinations', 'destinations', 'Backblaze B2 · immutable'],
    ['/jobs', 'jobs', 'Nightly production'],
    ['/members', 'members', 'Maya Chen'],
    ['/notifications', 'notifications', '#ops-alerts'],
    ['/audit', 'audit', 'restore.completed'],
    ['/workspace', 'workspace', 'Data scrubbing'],
  ]) {
    await page.goto(`${URL_}${path}`)
    await page.getByText(wait).first().waitFor()
    await shot(name)
  }
  await page.goto(`${URL_}/jobs`)
  await page.getByRole('button', { name: 'Actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByText('Retention (per destination)').waitFor()
  await shot('job-dialog')
  await page.keyboard.press('Escape')
  await page.locator('[data-sidebar="header"] button').first().click()
  await page.getByRole('menuitem', { name: 'Northwind Traders' }).waitFor()
  await shot('switcher')
  await page.keyboard.press('Escape')
}
await browser.close()
console.log('done →', OUT)
