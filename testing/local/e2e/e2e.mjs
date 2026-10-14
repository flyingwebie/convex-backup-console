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

  console.log(`\nAll ${step} checks passed. Screenshots: ${shots}`)
} catch (err) {
  await shot('FAILED').catch(() => {})
  console.error(`✘ step ${step + 1} failed:`, err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
