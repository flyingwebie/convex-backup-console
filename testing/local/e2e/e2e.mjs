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
  for (const [name, host] of [['Google', 'accounts.google.com'], ['GitHub', 'github.com'], ['Microsoft', 'login.microsoftonline.com']]) {
    const req = page.waitForRequest((r) => r.url().includes(host), { timeout: 15_000 })
    await page.route(`**://${host}/**`, (r) => r.abort())
    await page.getByRole('button', { name: `Continue with ${name}` }).click()
    const url = new URL((await req).url())
    if (!url.searchParams.get('client_id')?.startsWith('test-')) throw new Error(`${name}: missing client_id`)
    if (!url.searchParams.get('redirect_uri')?.endsWith(`/api/auth/callback/${name.toLowerCase()}`)) throw new Error(`${name}: wrong redirect_uri`)
    await page.unroute(`**://${host}/**`)
    await page.goto(`${URL_}/login`)
  }
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
  await page.getByLabel(/Also delete their backup files/).click()
  await page.getByRole('button', { name: 'Save policy' }).click()
  await page.getByText('Deletion policy saved').waitFor()
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  await dialog().getByLabel('Name').fill('purge-me')
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
  await page.getByText(/files are deleted from destinations when purged/).waitFor()
  await page.getByRole('button', { name: 'Delete now' }).click()
  await page.getByRole('alertdialog').getByText(/will be deleted from every destination/).waitFor()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click()
  await page.getByText('Trash is empty').waitFor()
  const final = s3ls().length
  if (final !== before) throw new Error(`Backup file not deleted from R2 (expected ${before}, found ${final})`)
  ok(`policy "delete backup files": purging the job removed its backup from R2 (${after} → ${final} objects)`)

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

  // Status URL, audit CSV, platform SMTP, digest + invitation emails, storage page
  await page.reload()
  await page.getByRole('button', { name: 'Enable' }).click()
  await page.getByText('Status URL enabled').waitFor()
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
  await page.getByRole('link', { name: 'Settings' }).click()
  await pick(page.getByRole('combobox').filter({ hasText: 'Off' }), 'Daily at 08:00')
  await page.getByLabel('Recipients').fill('ops@example.com')
  await page.getByRole('button', { name: 'Save digest' }).click()
  await page.getByText('Digest settings saved').waitFor()
  await page.reload()
  await page.getByRole('button', { name: 'Send test now' }).click()
  await page.getByText('Test digest sent').waitFor()
  await page.getByRole('link', { name: 'Members' }).click()
  await page.getByRole('button', { name: 'Invite member' }).click()
  await dialog().getByLabel('Email').fill('emailed@example.com')
  await dialog().getByRole('button', { name: 'Create invitation' }).click()
  await dialog().getByText(/We emailed/).waitFor()
  await dialog().getByRole('button', { name: 'Done' }).click()
  const mails = await (await fetch(`${env('MAILPIT', 'http://localhost:8025')}/api/v1/messages`)).json()
  const subjects = mails.messages.map((m) => m.Subject)
  if (!subjects.some((s) => /\[Flying Web\] Backup digest/.test(s))) throw new Error(`No digest email: ${subjects}`)
  if (!subjects.some((s) => /invited to Flying Web/.test(s))) throw new Error(`No invitation email: ${subjects}`)
  ok('digest email and invitation email delivered via platform SMTP')

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
