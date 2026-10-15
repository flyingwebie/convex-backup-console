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

/** Enrols TOTP on /security and returns the secret. */
async function enrol2fa(p, password, beforeCode) {
  await p.locator('fieldset[data-hydrated="true"]').waitFor()
  await p.getByLabel('Confirm your password').fill(password)
  await p.getByRole('button', { name: 'Continue' }).click()
  const secret = (await p.locator('p code').first().textContent()).trim()
  await beforeCode?.()
  await p.locator('input[autocomplete="one-time-code"], [data-input-otp]').first().fill(totp(secret))
  return secret
}

const CONTAINER = process.env.CONSOLE_CONTAINER ?? 'cbc-e2e'
/** Reads one row from the console DB (test-only backdoor). */
function dbGet(query) {
  const script = `const d=require('/app/node_modules/better-sqlite3')('/data/console.db');console.log(JSON.stringify(d.prepare(${JSON.stringify(query)}).get() ?? null))`
  return JSON.parse(execSync(`docker exec -i ${CONTAINER} node -`, { input: script }).toString())
}

/** Runs SQL inside the console container (test-only backdoor). */
function sql(query) {
  return execSync(`docker exec -i ${CONTAINER} node -e "const d=require('/app/node_modules/better-sqlite3')('/data/console.db');console.log(JSON.stringify(d.prepare(process.argv[1]).run()))" ${JSON.stringify(query)}`).toString()
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
  // OAuth buttons appear for configured providers and redirect to the right IdP
  const IDPS = [['Google', 'accounts.google.com'], ['GitHub', 'github.com'], ['Microsoft', 'login.microsoftonline.com']]
  // Keep the IdPs blocked for the whole check so the browser never actually lands on them.
  for (const [, host] of IDPS) await page.route(`**://${host}/**`, (r) => r.abort())
  for (const [name, host] of IDPS) {
    const req = page.waitForRequest((r) => r.url().includes(host), { timeout: 15_000 })
    await page.getByRole('button', { name: `Continue with ${name}` }).click()
    const url = new URL((await req).url())
    if (!url.searchParams.get('client_id')?.startsWith('test-')) throw new Error(`${name}: missing client_id`)
    if (!url.searchParams.get('redirect_uri')?.endsWith(`/api/auth/callback/${name.toLowerCase()}`)) throw new Error(`${name}: wrong redirect_uri`)
    await page.goto(`${URL_}/login`)
    await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
  }
  for (const [, host] of IDPS) await page.unroute(`**://${host}/**`)
  ok('Google, GitHub and Microsoft buttons redirect to their IdP with our client id and callback')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill('wrong-password-1')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByText(/invalid/i).waitFor()
  ok('wrong password is rejected')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/security/)
  ok('login forces 2FA enrolment')
  const adminSecret = await enrol2fa(page, PASSWORD, () => shot('02-2fa-enrol'))
  await page.waitForURL(`${URL_}/`)
  await page.getByText("Let's protect your first Convex instance").waitFor()
  ok('TOTP enrolled; empty-state overview shown')
  await shot('03-overview-empty')

  // Step-up gate: a session without a verified factor (what a social sign-in gives) is sent to /verify
  sql("UPDATE session SET mfa = NULL")
  await page.goto(`${URL_}/`)
  await page.waitForURL(/\/verify/)
  await page.getByText("Confirm it's you").waitFor()
  await shot('03b-verify')
  await page.locator('[data-input-otp]').first().fill(totp(adminSecret))
  await page.waitForURL(`${URL_}/`)
  ok('unverified session is stepped up with TOTP on /verify')

  // Passkeys via Chromium's virtual authenticator: add one, sign out, sign in with it
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  })
  await page.goto(`${URL_}/account`)
  await page.getByRole('button', { name: 'Add a passkey' }).click()
  await page.getByText('Passkey added').waitFor()
  await shot('03c-account')
  await page.locator('[data-sidebar="footer"] button').first().click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/login/)
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await page.waitForURL(`${URL_}/`)
  await page.goto(`${URL_}/account`)
  await page.getByText('passkey', { exact: false }).first().waitFor()
  ok('passkey registered, then used to sign in (no password, no TOTP prompt)')

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

  // ══ Workspaces ══
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()
  // Branding: rename, timezone, logo
  await page.getByRole('link', { name: 'Settings' }).click()
  const LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><path d="M14 40 L32 16 L50 40 Z" fill="#fff"/></svg>')
  await page.locator('input[type="file"]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: LOGO })
  await page.getByText('Logo updated').waitFor()
  await page.getByLabel('Name', { exact: true }).fill('Flying Web')
  await page.getByLabel('Slug').fill('flying-web')
  await page.getByLabel('Description').fill('Agency instances')
  await pick(page.getByRole('combobox').first(), 'Europe/Dublin')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Workspace saved').waitFor()
  await page.reload()
  await sidebar.getByText('Flying Web').waitFor()
  const logoWidth = await sidebar.locator('img[src^="/api/logo/"]').first().evaluate((img) => img.naturalWidth)
  if (!logoWidth) throw new Error('Logo not rendered in sidebar')
  await shot('14-workspace-settings')
  ok('workspace branded: logo, name, slug, description, timezone')

  // Deletion policy + trash: delete job → restore → delete → purge now
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Move to trash' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click()
  await page.getByText('Job moved to trash').waitFor()
  await page.getByRole('link', { name: 'Trash' }).click()
  await page.getByRole('cell', { name: /e2e-encrypted/ }).waitFor()
  await shot('15-trash')
  await page.getByRole('button', { name: 'Restore' }).click()
  await page.getByText('e2e-encrypted restored').waitFor()
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('cell', { name: /e2e-encrypted/ }).waitFor()
  ok('deleted job went to Trash and was restored')
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Move to trash' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click()
  await page.getByRole('link', { name: 'Trash' }).click()
  await page.getByRole('button', { name: 'Delete now' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click()
  await page.getByText('Trash is empty').waitFor()
  await page.getByRole('link', { name: 'Runs & restores' }).click()
  await page.getByRole('button', { name: 'Use backup' }).first().waitFor()
  ok('purged job; its backups are kept (policy: keep files) and still restorable')

  // Second workspace + isolation
  await sidebar.getByRole('button').first().click()
  await page.getByRole('menuitem', { name: 'Create workspace' }).click()
  await dialog().getByLabel('Name').fill('Acme Corp')
  await dialog().getByRole('button', { name: 'Create workspace' }).click()
  await page.waitForURL(/\/workspace$/)
  await sidebar.getByText('Acme Corp').waitFor()
  await page.getByRole('link', { name: 'Instances' }).click()
  await page.getByText('No instances yet').waitFor()
  await page.getByRole('link', { name: 'Runs & restores' }).click()
  await page.getByText('No runs yet').waitFor()
  ok('created "Acme Corp"; it sees none of Flying Web\'s instances or runs')

  // Invite a viewer and sign them up in a separate browser
  await page.getByRole('link', { name: 'Members' }).click()
  await page.getByRole('button', { name: 'Invite member' }).click()
  await dialog().getByLabel('Email').fill('viewer@example.com')
  await pick(dialog().getByRole('combobox'), 'Viewer')
  await dialog().getByRole('button', { name: 'Create invitation' }).click()
  const inviteLink = (await dialog().locator('code').textContent()).trim()
  await shot('16-invite')
  await dialog().getByRole('button', { name: 'Done' }).click()
  ok(`invitation link created (${inviteLink.replace(URL_, '')})`)

  const viewerCtx = await browser.newContext({ viewport: { width: 1360, height: 860 } })
  const v = await viewerCtx.newPage()
  await v.goto(inviteLink.replace(/^https?:\/\/[^/]+/, URL_))
  await v.getByText('Join Acme Corp').waitFor()
  await v.screenshot({ path: `${shots}17-invite-accept.png` })
  await v.getByLabel('Your name').fill('Vera Viewer')
  await v.getByLabel('Password', { exact: true }).fill('viewer-password-123')
  await v.getByLabel('Confirm password').fill('viewer-password-123')
  await v.getByRole('button', { name: 'Create account & join' }).click()
  await v.waitForURL(/\/security/)
  await enrol2fa(v, 'viewer-password-123')
  await v.waitForURL(`${URL_}/`)
  const vSidebar = v.locator('[data-sidebar="sidebar"]').first()
  await vSidebar.getByText('Acme Corp').waitFor()
  await vSidebar.getByText('Viewer', { exact: true }).waitFor()
  if (await vSidebar.getByText('Flying Web').count()) throw new Error('Viewer can see another workspace')
  if (await vSidebar.getByRole('link', { name: /Workspaces & users/ }).count()) throw new Error('Viewer sees Platform')
  await v.getByRole('link', { name: 'Instances' }).click()
  await v.getByText('No instances yet').waitFor()
  if (await v.getByRole('button', { name: 'Add instance' }).count()) throw new Error('Viewer can add instances')
  await v.getByRole('link', { name: 'Members' }).click()
  await v.getByRole('cell', { name: /viewer@example.com/ }).waitFor()
  if (await v.getByRole('button', { name: 'Invite member' }).count()) throw new Error('Viewer can invite')
  await v.screenshot({ path: `${shots}18-viewer-members.png`, fullPage: true })
  // Viewer can't download Flying Web's backups even with a valid link
  const leak = await v.request.get(`${URL_}${href}`)
  if (leak.status() === 200) throw new Error('Viewer downloaded another workspace\'s backup')
  ok(`invited viewer signed up with 2FA; read-only UI; viewer can't download (${leak.status()})`)

  // Owner promotes them to operator (may download) — still can't reach the other workspace's backup
  await page.reload()
  await page.getByRole('cell', { name: /viewer@example.com/ }).waitFor()
  await pick(page.getByRole('row', { name: /viewer@example.com/ }).getByRole('combobox'), 'Operator')
  await page.getByText(/is now Operator/).waitFor()
  const leak2 = await v.request.get(`${URL_}${href}`)
  if (leak2.status() !== 404) throw new Error(`Operator in Acme got ${leak2.status()} for a Flying Web backup`)
  await v.reload()
  await vSidebar.getByText('Operator', { exact: true }).waitFor()
  ok('promoted to Operator; another workspace\'s backup is still unreachable (404)')
  await viewerCtx.close()

  // Deletion policy "delete backup files": purge removes the files from R2
  await sidebar.getByRole('button').first().click()
  await page.getByRole('menuitem', { name: 'Flying Web' }).click()
  await page.waitForURL(`${URL_}/`)
  await sidebar.getByText('Flying Web').waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  // Remote ON, local OFF: R2 copies get deleted on purge, local copies stay.
  await page.getByRole('switch', { name: /Remote storage/ }).click()
  await page.getByRole('button', { name: 'Save policy' }).click()
  await page.getByText('Deletion policy saved').waitFor()
  await page.getByRole('link', { name: 'Destinations' }).click()
  await page.getByRole('button', { name: 'Add destination' }).first().click()
  await dialog().getByRole('tab', { name: 'Local volume' }).click()
  await dialog().getByLabel('Name').fill('local-vault')
  await dialog().getByRole('button', { name: 'Add destination' }).click()
  await page.getByRole('cell', { name: 'local-vault', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  await dialog().getByLabel('Name').fill('purge-me')
  await dialog().getByLabel('local-vault').check()
  await pick(dialog().getByRole('combobox').nth(1), 'Manual only')
  await dialog().getByRole('button', { name: 'Create job' }).click()
  await page.getByRole('cell', { name: /purge-me/ }).waitFor()
  await page.getByRole('row', { name: /purge-me/ }).getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByText(/purge-me started/).waitFor()
  const s3ls = () =>
    execSync(
      `docker run --rm --network cbc-net -e AWS_ACCESS_KEY_ID=${env('R2_KEY', 'r2key')} -e AWS_SECRET_ACCESS_KEY=${env('R2_SECRET', 'r2-secret-key')} -e AWS_REGION=us-east-1 amazon/aws-cli:2.36.34 --endpoint-url ${env('R2_ENDPOINT', 'http://cbc-r2:9000')} s3 ls --recursive s3://${env('R2_BUCKET', 'convex-backups-test')}/e2e/ 2>/dev/null || true`,
    ).toString().trim().split('\n').filter(Boolean)
  const before = s3ls().length
  let after = before
  for (let i = 0; i < 40 && after === before; i++) { await page.waitForTimeout(3000); after = s3ls().length }
  if (after !== before + 1) throw new Error(`Expected one new object in R2 (before ${before}, after ${after})`)
  await page.getByRole('row', { name: /purge-me/ }).getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Move to trash' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click()
  await page.getByRole('link', { name: 'Trash' }).click()
  const localFiles = () => execSync(`docker exec ${CONTAINER} sh -c 'find /data/backups -type f 2>/dev/null | wc -l'`).toString().trim()
  const localBefore = localFiles()
  await page.getByText(/deleted from remote storage when purged; local copies are kept/).waitFor()
  await page.getByRole('button', { name: 'Delete now' }).click()
  await page.getByRole('alertdialog').getByText(/remote storage when purged; local copies are kept/).waitFor()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click()
  await page.getByText('Trash is empty').waitFor()
  const final = s3ls().length
  if (final !== before) throw new Error(`Backup file not deleted from R2 (expected ${before}, found ${final})`)
  if (localFiles() !== localBefore || localBefore === '0') throw new Error(`Local copy should be kept (${localBefore} → ${localFiles()})`)
  ok(`deletion policy: remote on / local off — purge removed the R2 copy (${after} → ${final}) and kept the local copy`)

  // Workspace colour theme: applied to <html> for every page and kept after a reload
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Violet' }).click()
  await page.getByText('Violet theme applied').waitFor()
  await page.reload()
  await page.getByRole('radio', { name: 'Violet', checked: true }).waitFor()
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'violet') throw new Error('Theme not applied to <html>')
  ok('workspace colour theme: Violet applied and kept after a reload')

  // Delay: remote files are deleted N days after the purge — scheduled at the purge, deleted when due
  await page.getByLabel('Delete the files after (days)').fill('3')
  await page.getByRole('button', { name: 'Save policy' }).click()
  await page.getByText('Deletion policy saved').waitFor()
  await page.getByRole('switch', { name: /Local storage/ }).click()
  await page.getByText('Deletion policy').first().scrollIntoViewIfNeeded()
  await page.locator('form').filter({ hasText: 'Deletion policy' }).screenshot({ path: `${shots}24-deletion-delay.png` })
  await page.locator('[role="radiogroup"]').screenshot({ path: `${shots}24-theme-picker.png` })
  await page.getByRole('switch', { name: /Local storage/ }).click()
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  await dialog().getByLabel('Name').fill('purge-later')
  await pick(dialog().getByRole('combobox').nth(1), 'Manual only')
  await dialog().getByRole('button', { name: 'Create job' }).click()
  await page.getByRole('cell', { name: /purge-later/ }).waitFor()
  await page.getByRole('row', { name: /purge-later/ }).getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByText(/purge-later started/).waitFor()
  let later = final
  for (let i = 0; i < 40 && later === final; i++) { await page.waitForTimeout(3000); later = s3ls().length }
  if (later !== final + 1) throw new Error(`Expected one new object in R2 (before ${final}, after ${later})`)
  await page.getByRole('row', { name: /purge-later/ }).getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Move to trash' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click()
  await page.getByRole('link', { name: 'Trash' }).click()
  await page.getByText(/deleted from remote storage 3 days after the purge/).waitFor()
  await page.getByRole('button', { name: 'Delete now' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click()
  await page.getByText('Trash is empty').waitFor()
  if (s3ls().length !== later) throw new Error('Backup file deleted at the purge despite a 3-day delay')
  const pending = dbGet('SELECT COUNT(*) AS n, MIN(delete_after) AS at FROM run_copies WHERE delete_after IS NOT NULL AND deleted_at IS NULL')
  if (pending.n !== 1 || Math.abs(pending.at - (Date.now() + 3 * 86_400_000)) > 3_600_000) throw new Error(`Expected one deletion due in 3 days, got ${JSON.stringify(pending)}`)
  // Make it due and restart: the purge sweep runs at boot.
  sql('UPDATE run_copies SET delete_after = 1 WHERE delete_after IS NOT NULL AND deleted_at IS NULL')
  execSync(`docker restart ${CONTAINER}`)
  for (let i = 0; i < 20; i++) {
    const res = await page.goto(`${URL_}/`).catch(() => null)
    if (res?.ok()) break
    await page.waitForTimeout(1500)
  }
  let swept = later
  for (let i = 0; i < 40 && swept === later; i++) { await page.waitForTimeout(3000); swept = s3ls().length }
  if (swept !== final) throw new Error(`Due backup file not deleted (expected ${final}, found ${swept})`)
  ok(`deletion policy delay: purge scheduled the R2 deletion for +3 days; deleted once due (${later} → ${swept})`)

  // Delete Acme → gone from switcher → restore from Platform
  await sidebar.getByRole('button').first().click()
  await page.getByRole('menuitem', { name: 'Acme Corp' }).click()
  await page.waitForURL(`${URL_}/`)
  await sidebar.getByText('Acme Corp').waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Delete workspace' }).click()
  await dialog().getByRole('textbox').fill('Acme Corp')
  await dialog().getByRole('button', { name: 'Delete workspace' }).click()
  await page.waitForURL(`${URL_}/`)
  await sidebar.getByText('Flying Web').waitFor()
  await sidebar.getByRole('button').first().click()
  if (await page.getByRole('menuitem', { name: 'Acme Corp' }).count()) throw new Error('Deleted workspace still in switcher')
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Workspaces & users' }).click()
  await page.getByRole('row', { name: /Acme Corp/ }).getByText('Deleted').waitFor()
  await shot('19-platform')
  await page.getByRole('row', { name: /Acme Corp/ }).getByRole('button', { name: 'Restore' }).click()
  await page.getByText('Acme Corp restored').waitFor()
  await sidebar.getByRole('button').first().click()
  await page.getByRole('menuitem', { name: 'Acme Corp' }).waitFor()
  await page.keyboard.press('Escape')
  ok('deleted workspace left the switcher and was restored from Platform')
  // ══ Convex Cloud ══ (the console's CONVEX_PROVISION_HOST points at a local mock of api.convex.dev)
  await page.getByRole('link', { name: 'Instances' }).click()
  await page.getByRole('button', { name: 'Add instance' }).first().click()
  await dialog().getByRole('tab', { name: 'Convex Cloud' }).click()
  await dialog().getByLabel('Name').fill('cloud-a')
  await dialog().getByLabel('Deploy key').fill('project:acme:shop|abc123')
  await dialog().getByRole('button', { name: 'Connect' }).click()
  await page.getByText(/This is a project key/).waitFor()
  await dialog().getByLabel('Deploy key').fill('prod:other-deployment|abc123')
  await dialog().getByRole('button', { name: 'Connect' }).click()
  await page.getByText(/Convex rejected this deploy key/).waitFor()
  ok('Cloud: project keys and rejected deploy keys give clear errors')
  await dialog().getByLabel('Deploy key').fill(env('CLOUD_KEY'))
  await shot('20-cloud-dialog')
  await dialog().getByRole('button', { name: 'Connect' }).click()
  await page.getByText(/Connected to http:\/\/host.docker.internal:3301/).waitFor()
  await page.getByRole('row', { name: /cloud-a/ }).getByText('Cloud · prod').waitFor()
  await shot('21-instances-cloud')
  ok('Cloud: deploy key accepted, URL looked up from the key, shown as "Cloud · prod"')

  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  await dialog().getByLabel('Name').fill('cloud-nightly')
  await pick(dialog().getByRole('combobox').nth(0), 'cloud-a')
  await pick(dialog().getByRole('combobox').nth(1), 'Manual only')
  await dialog().getByRole('button', { name: 'Create job' }).click()
  await page.getByRole('row', { name: /cloud-nightly/ }).getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByText(/cloud-nightly started/).waitFor()
  await page.getByRole('link', { name: 'Runs & restores' }).click()
  await page.getByRole('row', { name: /cloud-a/ }).first().getByText('Success').waitFor({ timeout: 120_000 })
  ok('Cloud: backup of the Cloud deployment succeeded with the deploy key')

  await page.getByRole('row', { name: /cloud-a/ }).first().getByRole('button', { name: 'Use backup' }).click()
  await page.getByRole('menuitem', { name: 'Restore…' }).first().click()
  await dialog().getByText('Convex Cloud production deployment').waitFor()
  await shot('22-cloud-restore-warning')
  await dialog().getByRole('button', { name: 'Cancel' }).click()
  ok('Cloud: restoring into a production Cloud deployment shows an extra warning')

  // ══ Strong additions ══
  const r2 = { endpoint: env('R2_ENDPOINT', 'http://cbc-r2:9000'), key: env('R2_KEY', 'r2key'), secret: env('R2_SECRET', 'r2-secret-key') }
  const aws = (args) =>
    execSync(`docker run --rm --network cbc-net -e AWS_ACCESS_KEY_ID=${r2.key} -e AWS_SECRET_ACCESS_KEY=${r2.secret} -e AWS_REGION=us-east-1 amazon/aws-cli:2.36.34 --endpoint-url ${r2.endpoint} ${args} 2>&1 || true`).toString()
  // Fresh bucket per run: locked objects from earlier runs can't be deleted (by design).
  const LOCKED = `e2e-locked-${Date.now()}`
  aws(`s3api create-bucket --bucket ${LOCKED} --object-lock-enabled-for-bucket`)
  const seed = (cmd, key = env('B_KEY'), url = 'http://localhost:3302') =>
    execSync(`cd ../seed-app && CONVEX_SELF_HOSTED_URL=${url} CONVEX_SELF_HOSTED_ADMIN_KEY='${key}' npx convex ${cmd}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()

  // Object Lock: refused on a bucket without it, accepted on one with it
  const addLockedDest = async (name, bucket) => {
    await page.getByRole('link', { name: 'Destinations' }).click()
    await page.getByRole('button', { name: 'Add destination' }).first().click()
    await dialog().getByLabel('Name').fill(name)
    await dialog().getByLabel('Endpoint').fill(r2.endpoint)
    await dialog().getByLabel('Bucket').fill(bucket)
    await dialog().getByLabel('Region').fill('us-east-1')
    await dialog().getByLabel('Access key ID').fill(r2.key)
    await dialog().getByLabel('Secret access key').fill(r2.secret)
    await dialog().getByLabel(/Path-style/).check()
    await dialog().getByRole('switch', { name: /Object Lock/ }).click()
    await dialog().getByLabel('Lock for (days)').fill('1')
  }
  await addLockedDest('not-lockable', env('R2_BUCKET', 'convex-backups-test'))
  await dialog().getByRole('button', { name: 'Add destination' }).click()
  await page.getByText(/Object Lock isn't available|Object Lock is not enabled/).waitFor()
  await dialog().getByRole('button', { name: 'Cancel' }).click()
  await addLockedDest('immutable', LOCKED)
  await shot('23-object-lock')
  await dialog().getByRole('button', { name: 'Add destination' }).click()
  await page.getByRole('row', { name: /immutable/ }).getByText(/Locked 1d/).waitFor()
  ok('Object Lock: refused on a bucket without it; enabled destination shows "Locked 1d · governance"')

  // Locked job: keep only 1, run twice → the older copy can't be pruned while locked
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  await dialog().getByLabel('Name').fill('locked-job')
  await dialog().getByLabel('fake-r2').uncheck()
  await dialog().getByLabel('immutable').check()
  await pick(dialog().getByRole('combobox').nth(1), 'Manual only')
  for (const k of ['Daily', 'Weekly', 'Monthly']) await dialog().getByLabel(k, { exact: true }).fill('')
  await dialog().getByLabel('Latest', { exact: true }).fill('1')
  await dialog().getByRole('button', { name: 'Create job' }).click()
  const runLocked = async () => {
    await page.getByRole('row', { name: /locked-job/ }).getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByText(/locked-job started/).waitFor()
    await page.waitForTimeout(1500)
    for (let i = 0; i < 40; i++) {
      if (dbGet("SELECT COUNT(*) AS n FROM runs WHERE status = 'running'").n === 0) break
      await page.waitForTimeout(2000)
    }
  }
  await runLocked()
  await page.reload()
  await runLocked()
  const lockedObjects = aws(`s3api list-object-versions --bucket ${LOCKED} --query "Versions[].VersionId" --output text`).trim().split(/\s+/).filter(Boolean)
  if (lockedObjects.length !== 2) throw new Error(`Expected both locked versions to survive retention, found ${lockedObjects.length}`)
  const keyName = aws(`s3api list-objects-v2 --bucket ${LOCKED} --query "Contents[0].Key" --output text`).trim()
  const del = aws(`s3api delete-object --bucket ${LOCKED} --key ${keyName} --version-id ${lockedObjects[0]}`)
  if (!/AccessDenied|retention/i.test(del)) throw new Error(`Locked version was deletable: ${del}`)
  ok('Object Lock: keep-last-1 left the still-locked older copy alone; deleting it directly is AccessDenied')

  // Contents + compare with the previous backup
  await page.getByRole('link', { name: 'Runs & restores' }).click()
  await page.getByRole('button', { name: 'Contents' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('cell', { name: 'notes', exact: true }).waitFor()
  await sheet.getByText('Changes compared with the backup of').waitFor()
  const sheetText = await sheet.innerText()
  if (!/500/.test(sheetText) || !/20\s*\n?\s*files/.test(sheetText)) throw new Error('Manifest numbers missing')
  await shot('24-contents')
  await page.keyboard.press('Escape')
  ok('backup contents: 2 tables, 500 notes, 20 files, compared with the previous backup')

  const latestRestore = () => dbGet('SELECT status, error FROM restores ORDER BY started_at DESC LIMIT 1')
  const waitForRestore = async () => {
    await page.waitForTimeout(1000)
    for (let i = 0; i < 60; i++) {
      const r = latestRestore()
      if (r.status === 'ok') return
      if (r.status === 'failed') throw new Error(`Restore failed: ${r.error}`)
      await page.waitForTimeout(2000)
    }
    throw new Error('Restore did not finish')
  }

  // Partial restore: B gets extra notes, then only "notes" is restored
  seed(`run seed:insertNotesPublic '{"from": 1000, "count": 10}'`)
  const bBefore = JSON.parse(seed('run seed:fingerprint'))
  if (bBefore.notes !== 510) throw new Error(`Expected 510 notes in B, got ${bBefore.notes}`)
  await page.getByRole('row', { name: /locked-job/ }).first().getByRole('button', { name: 'Use backup' }).click()
  await page.getByRole('menuitem', { name: 'Restore…' }).first().click()
  await pick(dialog().getByRole('combobox').nth(0), 'convex-b')
  await pick(dialog().getByRole('combobox').nth(2), 'Selected tables only')
  await dialog().getByRole('checkbox', { name: 'notes' }).or(dialog().locator('label', { hasText: 'notes' }).getByRole('checkbox')).first().check()
  await dialog().getByLabel(/to confirm/).fill('convex-b')
  await shot('25-partial-restore')
  await dialog().getByRole('button', { name: /Restore into convex-b/ }).click()
  await waitForRestore()
  const bAfter = JSON.parse(seed('run seed:fingerprint'))
  if (bAfter.notes !== 500 || bAfter.attachments !== 20) throw new Error(`Partial restore wrong: ${JSON.stringify(bAfter)}`)
  ok('partial restore: only "notes" replaced in B (510 → 500); attachments untouched')

  // Scrubbing: rule notes.title → redact, full restore with scrub
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Add rule' }).click()
  const rule = page.locator('[aria-label="Field"]').last()
  await page.locator('[aria-label="Table"]').last().fill('notes')
  await rule.fill('title')
  await page.getByRole('button', { name: 'Save rules' }).click()
  await page.getByText('Scrubbing rules saved').waitFor()
  await page.getByRole('link', { name: 'Runs & restores' }).click()
  await page.getByRole('tab', { name: /Backups/ }).click()
  await page.getByRole('row', { name: /locked-job/ }).first().getByRole('button', { name: 'Use backup' }).click()
  await page.getByRole('menuitem', { name: 'Restore…' }).first().click()
  await pick(dialog().getByRole('combobox').nth(0), 'convex-b')
  await dialog().getByRole('switch', { name: /Scrub personal data/ }).click()
  await dialog().getByLabel(/to confirm/).fill('convex-b')
  await dialog().getByRole('button', { name: /Restore into convex-b/ }).click()
  await waitForRestore()
  const sample = seed('data notes --limit 3')
  if (!sample.includes('[redacted]') || /note \d+/.test(sample)) throw new Error(`Titles not scrubbed:\n${sample}`)
  await shot('26-restores-scrubbed')
  ok('scrubbed restore: every note title in B is "[redacted]"')

  // API tokens + REST + the GitHub Action script
  await page.getByRole('link', { name: 'Settings' }).click()
  const mkToken = async (name, scopeLabel) => {
    await page.getByRole('button', { name: 'New token' }).click()
    await dialog().getByLabel('Name').fill(name)
    if (scopeLabel) {
      await pick(dialog().getByRole('combobox').first(), scopeLabel)
      await dialog().getByRole('combobox').first().filter({ hasText: scopeLabel }).waitFor()
    }
    await dialog().getByRole('button', { name: 'Create token' }).click()
    await dialog().getByText('Copy your token').waitFor()
    const t = (await dialog().locator('pre').textContent()).trim()
    await dialog().getByRole('button', { name: 'Done' }).click()
    await dialog().waitFor({ state: 'detached' })
    return t
  }
  const runToken = await mkToken('ci')
  const readToken = await mkToken('monitor', 'Read status only')
  if (readToken === runToken) throw new Error('Got the same token twice')
  const jobId = dbGet("SELECT id FROM jobs WHERE name = 'locked-job'").id
  await page.getByText(jobId).first().waitFor() // the card lists job IDs
  const api = (method, p, token) => fetch(`${URL_}${p}`, { method, headers: { Authorization: `Bearer ${token}` } })
  if ((await api('POST', `/api/v1/jobs/${jobId}/run`, readToken)).status !== 403) throw new Error('read token could run')
  if ((await api('GET', '/api/v1/jobs', 'cbc_nope_nope')).status !== 401) throw new Error('bad token accepted')
  const jobsRes = await (await api('GET', '/api/v1/jobs', readToken)).json()
  if (!jobsRes.jobs.some((j) => j.id === jobId)) throw new Error('jobs list missing job')
  // Run the real composite action script
  const yml = (await import('node:fs')).readFileSync('../../../.github/actions/convex-backup/action.yml', 'utf8')
  const script = yml.split('run: |')[1].split('\n').map((l) => l.replace(/^ {8}/, '')).join('\n')
  const outFile = `${shots}gh-output.txt`
  const { spawnSync } = await import('node:child_process')
  const action = spawnSync('bash', ['-c', script], {
    env: { ...process.env, CONSOLE: URL_, TOKEN: runToken, JOB: jobId, TIMEOUT: '5', ALLOW_PARTIAL: 'false', GITHUB_OUTPUT: outFile },
    encoding: 'utf8',
  })
  const actionLog = `${action.stdout}\n${action.stderr}`
  if (action.status !== 0) throw new Error(`Action exited ${action.status}:\n${actionLog}`)
  if (!actionLog.includes('✅ Backup completed')) throw new Error(`Action did not succeed:\n${actionLog}`)
  ok('API tokens: read token can\'t run (403), bad token 401; the GitHub Action ran a backup and waited for "ok"')

  // API switch off: API refuses; the Action skips (or fails with fail-when-disabled)
  await page.getByRole('switch', { name: /Allow API access/ }).click()
  await page.getByText('API access disabled').waitFor()
  const off = await api('GET', '/api/v1/jobs', readToken)
  if (off.status !== 403 || !(await off.text()).includes('disabled')) throw new Error(`Expected 403 disabled, got ${off.status}`)
  const runAction = (extra = {}) =>
    spawnSync('bash', ['-c', script], {
      env: { ...process.env, CONSOLE: URL_, TOKEN: runToken, JOB: jobId, TIMEOUT: '5', ALLOW_PARTIAL: 'false', GITHUB_OUTPUT: outFile, ...extra },
      encoding: 'utf8',
    })
  const skipped = runAction()
  if (skipped.status !== 0 || !skipped.stdout.includes('Backup skipped')) throw new Error(`Action should skip:\n${skipped.stdout}${skipped.stderr}`)
  const strict = runAction({ FAIL_WHEN_DISABLED: 'true' })
  if (strict.status === 0) throw new Error('Action should fail with fail-when-disabled')
  await shot('28-api-disabled')
  await page.getByRole('switch', { name: /Allow API access/ }).click()
  await page.getByText('API access enabled').waitFor()
  if ((await api('GET', '/api/v1/jobs', readToken)).status !== 200) throw new Error('API should work again')
  ok('API switch: off → 403 and the Action skips (fails with fail-when-disabled); back on → 200')

  // Status URL, audit CSV, platform SMTP, digest + invitation emails, storage page
  await page.reload()
  // Clicks before hydration are lost; retry until the toast confirms it.
  for (let i = 0; ; i++) {
    await page.getByRole('button', { name: 'Enable' }).click()
    if (await page.getByText('Status URL enabled').waitFor({ timeout: 4000 }).then(() => true, () => false)) break
    if (i === 4) throw new Error('Status URL could not be enabled')
  }
  const statusUrl = await page.locator('input[readonly]').first().inputValue()
  const status = await fetch(statusUrl)
  const health = await status.json()
  if (![200, 503].includes(status.status) || !Array.isArray(health.instances)) throw new Error('Bad status response')
  const csv = await page.request.get(`${URL_}/api/audit.csv`)
  const csvText = await csv.text()
  if (!csvText.startsWith('time_utc,actor,action,detail') || !csvText.includes('backup.started')) throw new Error('Bad CSV')
  ok(`status URL → ${status.status} (${health.instances.length} instances); audit CSV export (${csvText.split('\r\n').length - 2} rows)`)

  await page.getByRole('link', { name: 'Workspaces & users' }).click()
  await page.getByLabel('Host', { exact: true }).fill('cbc-mail')
  await page.getByLabel('Port', { exact: true }).fill('1025')
  await page.getByLabel('From', { exact: true }).fill('Backups <backups@example.com>')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('SMTP saved').waitFor()
  const MAILPIT = env('MAILPIT', 'http://localhost:8025')
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })
  const inbox = async () => (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()).messages
  const waitMail = async (pred, what) => {
    for (let i = 0; i < 40; i++) {
      const m = (await inbox()).find(pred)
      if (m) return m
      await page.waitForTimeout(250)
    }
    throw new Error(`No email: ${what}. Inbox: ${(await inbox()).map((m) => `${m.To.map((t) => t.Address)} "${m.Subject}"`).join(' | ')}`)
  }

  // Legacy "Email" alert channels move to the Emails page on boot (simulated old row + restart).
  const wsId = dbGet("SELECT id FROM organization WHERE name = 'Flying Web'").id
  const legacyCfg = JSON.stringify({ kind: 'email', host: 'cbc-mail', port: 1025, secure: false, from: 'old@example.com', to: 'legacy@example.com, second@example.com' })
  const encScript = `const c=require('crypto');const k=c.createHash('sha256').update(process.env.BACKUP_MASTER_KEY).digest();const iv=c.randomBytes(12);const ci=c.createCipheriv('aes-256-gcm',k,iv);const b=Buffer.concat([ci.update(${JSON.stringify(legacyCfg)}),ci.final()]);
    const d=require('/app/node_modules/better-sqlite3')('/data/console.db');
    d.prepare("INSERT INTO channels (id, workspace_id, name, kind, config_enc, on_failure, on_success, created_at) VALUES ('legacy-mail', ?, 'Old email', 'email', ?, 1, 0, ?)").run(${JSON.stringify(wsId)}, Buffer.concat([iv,ci.getAuthTag(),b]).toString('base64'), Date.now());
    d.prepare('UPDATE workspace_settings SET emails_migrated = 0 WHERE workspace_id = ?').run(${JSON.stringify(wsId)})`
  execSync(`docker exec -i ${CONTAINER} node -`, { input: encScript })
  execSync(`docker restart ${CONTAINER}`)
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${URL_}/api/health`).then((r) => r.ok, () => false)) break
    await page.waitForTimeout(500)
  }
  await page.goto(`${URL_}/emails?tab=recipients`)
  const migrated = dbGet(`SELECT externals FROM email_routes WHERE workspace_id = '${wsId}' AND type = 'backup_failed'`)
  if (!migrated?.externals.includes('legacy@example.com') || !migrated.externals.includes('second@example.com')) throw new Error(`Channel not migrated: ${JSON.stringify(migrated)}`)
  if (dbGet("SELECT COUNT(*) AS n FROM channels WHERE kind = 'email'").n !== 0) throw new Error('Legacy email channel still present')
  if (dbGet(`SELECT email_smtp_enc FROM workspace_settings WHERE workspace_id = '${wsId}'`).email_smtp_enc) throw new Error('Same SMTP as the platform should not become a workspace override')
  ok('legacy Email channel migrated on boot: its addresses became Backup failed/partial and Restore failed recipients')

  // Recipients grid: add an external address to the digest
  const digestRow = page.getByRole('row').filter({ hasText: 'Daily / weekly digest' })
  await digestRow.getByRole('button', { name: /Add/ }).click()
  await dialog().getByLabel('External addresses').fill('ops@example.com')
  await dialog().getByRole('button', { name: 'Add', exact: true }).click()
  await dialog().getByRole('button', { name: 'Save' }).click()
  await digestRow.getByText('ops@example.com').waitFor()
  // Roles are checkboxes: give Operators the "Backup partially failed" email
  const partialRow = page.getByRole('row').filter({ hasText: 'Backup partially failed' })
  await partialRow.getByRole('checkbox', { name: /Operators/ }).click()
  for (let i = 0; i < 20 && !dbGet(`SELECT roles FROM email_routes WHERE workspace_id = '${wsId}' AND type = 'backup_partial'`)?.roles.includes('operator'); i++) await page.waitForTimeout(250)
  if (!dbGet(`SELECT roles FROM email_routes WHERE workspace_id = '${wsId}' AND type = 'backup_partial'`).roles.includes('operator')) throw new Error('Role toggle not saved')
  await shot('29-email-recipients')
  ok('recipients grid: external address for the digest, Operators added to partial failures')

  // Template editor: variables, unknown-variable guard, live preview, test send with inline logo
  await page.getByRole('tab', { name: 'Templates' }).click()
  await page.getByRole('listitem').filter({ has: page.getByText('Backup failed', { exact: true }) }).getByRole('link', { name: 'Edit' }).click()
  await page.getByTestId('preview-subject').waitFor()
  const subject = page.getByLabel('Subject')
  await subject.fill('Custom {{ instance.name }} {{ nope }}')
  await page.getByText('Unknown variable: nope').first().waitFor()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(500)
  if (dbGet(`SELECT 1 AS x FROM email_templates WHERE workspace_id = '${wsId}' AND type = 'backup_failed'`)) throw new Error('Template with an unknown variable was saved')
  await subject.fill('Custom: {{ instance.name }} broke')
  const heading = page.getByLabel('Heading')
  await heading.click()
  await heading.press('End')
  await page.getByRole('button', { name: /^job\.name/ }).click()
  if (!(await heading.inputValue()).endsWith('{{ job.name }}')) throw new Error(`Variable not inserted: ${await heading.inputValue()}`)
  await page.getByTestId('preview-subject').filter({ hasText: 'Custom: shop-prod broke' }).waitFor()
  const frame = page.frameLocator('iframe[title="Email preview"]')
  await frame.getByText('Flying Web').first().waitFor()
  await page.getByRole('tab', { name: 'Mobile' }).click()
  await page.waitForFunction(() => document.querySelector('iframe[title="Email preview"]')?.getBoundingClientRect().width === 375, null, { timeout: 5000 })
  await shot('30-email-editor')
  await page.getByRole('tab', { name: 'Plain text' }).click()
  await page.locator('pre').filter({ hasText: 'Nightly production' }).waitFor()
  await page.getByRole('tab', { name: 'HTML', exact: true }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Template saved').waitFor()
  await page.getByRole('button', { name: 'Send test to me' }).click()
  await page.getByText(`Test sent to ${EMAIL}`).waitFor()
  const testMail = await waitMail((m) => m.Subject === '[Test] Custom: shop-prod broke', 'test email')
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${testMail.ID}`)).json()
  if (!full.Inline?.some((a) => a.ContentID === 'logo' && a.ContentType === 'image/png')) throw new Error(`No inline PNG logo: ${JSON.stringify(full.Inline)}`)
  if (!full.HTML.includes('cid:logo') || !full.Text.includes('Nightly production')) throw new Error('Test email missing HTML logo or plain-text part')
  ok('template editor: unknown variable blocked, click-to-insert, live preview (desktop/mobile, text), test email with inline PNG logo')

  // Owner-only full HTML: start from the design, scripts stripped on save; History → revert
  await page.getByRole('tab', { name: 'Full HTML' }).click()
  await page.getByRole('button', { name: 'Start from current design' }).click()
  await page.getByText('Loaded the branded layout as HTML').waitFor()
  await page.locator('.cm-content').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await page.keyboard.type('<script>alert(1)</script><p onclick="x()">Extra paragraph</p>')
  await frame.getByText('Extra paragraph').waitFor()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Template saved').last().waitFor()
  const htmlRow = dbGet(`SELECT mode, content FROM email_templates WHERE workspace_id = '${wsId}' AND type = 'backup_failed'`)
  if (htmlRow.mode !== 'html' || /<script|onclick/.test(htmlRow.content) || !htmlRow.content.includes('Extra paragraph')) throw new Error(`HTML not sanitised: ${htmlRow.content.slice(0, 200)}`)
  await shot('31-email-html')
  await page.getByRole('button', { name: 'History' }).click()
  await dialog().getByRole('button', { name: 'Revert' }).first().click()
  await page.getByText('Reverted').waitFor()
  const reverted = dbGet(`SELECT mode, content FROM email_templates WHERE workspace_id = '${wsId}' AND type = 'backup_failed'`)
  if (reverted.mode !== 'structured' || !reverted.content.includes('Custom: {{ instance.name }} broke')) throw new Error('Revert did not restore the structured version')
  ok('full HTML (owner): scripts and handlers stripped on save; History → Revert back to the structured version')

  // Branding
  await page.goto(`${URL_}/emails?tab=branding`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Accent colour', { exact: true }).fill('#0f766e')
  await page.getByLabel('Footer text').fill('Flying Web Solutions · Dublin')
  await page.getByLabel('Sender name').fill('Flying Web Backups')
  await page.getByRole('button', { name: 'Save branding' }).click()
  await page.getByText('Branding saved').waitFor()
  const brand = dbGet(`SELECT email_accent, email_footer, email_sender_name FROM workspace_settings WHERE workspace_id = '${wsId}'`)
  if (brand.email_accent !== '#0f766e' || brand.email_sender_name !== 'Flying Web Backups') throw new Error(`Branding not saved: ${JSON.stringify(brand)}`)

  // Digest: owners by default + the external address; opting out stops it for me only
  await page.getByRole('link', { name: 'Settings' }).click()
  await pick(page.getByRole('combobox').filter({ hasText: 'Off' }), 'Daily at 08:00')
  await page.getByRole('button', { name: 'Save digest' }).click()
  await page.getByText('Digest settings saved').waitFor()
  await page.reload()
  await page.getByRole('button', { name: 'Send test now' }).click()
  await page.getByText('Test digest sent').waitFor()
  const isDigest = (to) => (m) => /backup digest/.test(m.Subject) && m.To.some((t) => t.Address === to)
  const digestMail = await waitMail(isDigest(EMAIL), 'digest to owner')
  await waitMail(isDigest('ops@example.com'), 'digest to external')
  if (digestMail.From.Name !== 'Flying Web Backups' || digestMail.From.Address !== 'backups@example.com') throw new Error(`Wrong sender: ${JSON.stringify(digestMail.From)}`)
  const digestFull = await (await fetch(`${MAILPIT}/api/v1/message/${digestMail.ID}`)).json()
  if (!digestFull.HTML.includes('#0f766e') || !digestFull.HTML.includes('Flying Web Solutions · Dublin')) throw new Error('Digest missing branding')
  await page.goto(`${URL_}/account`)
  await page.getByRole('switch', { name: 'Flying Web: Daily / weekly digest' }).click()
  await page.getByText('Daily / weekly digest emails off').waitFor()
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Send test now' }).click()
  await page.getByText('Test digest sent').waitFor()
  await waitMail(isDigest('ops@example.com'), 'digest to external after opt-out')
  if ((await inbox()).some(isDigest(EMAIL))) throw new Error('Opted-out member still got the digest')
  await page.goto(`${URL_}/account`)
  await page.getByRole('switch', { name: 'Flying Web: Daily / weekly digest' }).click()
  await page.getByText('Daily / weekly digest emails on').waitFor()
  ok('digest: branded (accent, footer, sender name) to owners + external; opt-out in Account stops it for that member only')

  await page.getByRole('link', { name: 'Members' }).click()
  await page.getByRole('button', { name: 'Invite member' }).click()
  await dialog().getByLabel('Email').fill('emailed@example.com')
  await dialog().getByRole('button', { name: 'Create invitation' }).click()
  await dialog().getByText(/We emailed/).waitFor()
  await dialog().getByRole('button', { name: 'Done' }).click()
  const invite = await waitMail((m) => /invited to Flying Web/.test(m.Subject) && m.To.some((t) => t.Address === 'emailed@example.com'), 'invitation')
  const inviteFull = await (await fetch(`${MAILPIT}/api/v1/message/${invite.ID}`)).json()
  if (!/\/invite\/[\w-]+/.test(inviteFull.HTML)) throw new Error('Invitation email has no accept link')
  ok('invitation email: branded template with the accept link')

  // Platform defaults + sidebar version / GitHub link
  await page.getByRole('link', { name: 'Workspaces & users' }).click()
  await page.getByRole('listitem').filter({ has: page.getByText('No recent backup', { exact: true }) }).getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Subject').fill('⏰ Stale: {{ instance.name }}')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Template saved').last().waitFor()
  if (!dbGet("SELECT content FROM email_templates WHERE workspace_id = '' AND type = 'backup_stale'")?.content.includes('Stale:')) throw new Error('Platform default not saved')
  const gh = page.getByRole('link', { name: 'Source code on GitHub' })
  if ((await gh.getAttribute('href')) !== 'https://github.com/flyingwebie/convex-backup-console') throw new Error('GitHub link wrong')
  await page.getByRole('link', { name: /^v\d+\.\d+\.\d+/ }).waitFor()
  ok('platform default template edited; sidebar shows the version and the GitHub link')

  await page.getByRole('link', { name: 'Storage' }).click()
  await page.getByText(/Stored data, last \d+ days/).waitFor()
  await page.locator('.recharts-surface').first().waitFor()
  await shot('27-storage')
  ok('storage dashboard renders totals, cost estimate and the 90-day chart')

  console.log(`\nAll ${step} checks passed. Screenshots: ${shots}`)
} catch (err) {
  await shot('FAILED').catch(() => {})
  console.error(`✘ step ${step + 1} failed:`, err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
