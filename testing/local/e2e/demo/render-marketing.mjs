// Renders marketing images from real product screenshots (docs/images/screens) into docs/images.
import fs from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('../../../../', import.meta.url).pathname
const OUT = `${ROOT}docs/images/`
const img = (name) => `data:image/png;base64,${fs.readFileSync(`${OUT}screens/${name}.png`).toString('base64')}`
const logo = `data:image/svg+xml;base64,${fs.readFileSync(`${ROOT}docs/images/logo.svg`).toString('base64')}`

const base = `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; }
    body { font-family: Inter, system-ui, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; overflow: hidden; }
    .bg { position: absolute; inset: 0; background:
      radial-gradient(1200px 700px at 85% 10%, rgba(124,58,237,.55), transparent 60%),
      radial-gradient(900px 600px at 0% 100%, rgba(37,99,235,.45), transparent 60%),
      radial-gradient(600px 400px at 50% 60%, rgba(249,115,22,.12), transparent 70%), #0b0b14; }
    .grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
      background-size: 48px 48px; mask-image: radial-gradient(ellipse at 60% 40%, #000 30%, transparent 75%); }
    .window { border-radius: 16px; overflow: hidden; background: #111; box-shadow: 0 40px 120px -20px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.1); }
    .window .bar { height: 34px; background: #1b1b22; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid rgba(255,255,255,.06); }
    .window .bar i { width: 12px; height: 12px; border-radius: 50%; background: #3a3a44; display: inline-block; }
    .window .bar i:nth-child(1) { background: #ff5f57 } .window .bar i:nth-child(2) { background: #febc2e } .window .bar i:nth-child(3) { background: #28c840 }
    .window .bar span { margin-left: 14px; font-size: 12px; color: #8b8b96; background: #24242c; padding: 4px 12px; border-radius: 6px; }
    .window img { display: block; width: 100%; }
    .pill { display: inline-flex; align-items: center; gap: 10px; padding: 8px 16px 8px 8px; border-radius: 999px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); font-size: 15px; font-weight: 600; }
    .pill img { width: 30px; height: 30px; }
    h1 { font-weight: 800; letter-spacing: -0.035em; line-height: 1.02; }
    .grad { background: linear-gradient(90deg, #c4b5fd, #93c5fd 50%, #fdba74); -webkit-background-clip: text; color: transparent; }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; }
    .chip { font-size: 15px; font-weight: 500; padding: 8px 14px; border-radius: 10px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #e5e5ef; }
    .chip b { color: #fff }
    .muted { color: #b4b4c4; }
  </style>`

const win = (src, url = 'backups.acme.dev') => `<div class="window"><div class="bar"><i></i><i></i><i></i><span>🔒 ${url}</span></div><img src="${src}"></div>`

const pages = {
  hero: [1600, 900, `
    <div class="bg"></div><div class="grid"></div>
    <div style="position:absolute;left:84px;top:110px;width:640px">
      <div class="pill"><img src="${logo}">Convex Backup Console</div>
      <h1 style="font-size:70px;margin-top:30px">Backups for Convex<br><span class="grad">you can actually restore.</span></h1>
      <p class="muted" style="font-size:21px;line-height:1.55;margin-top:26px">Scheduled, encrypted, off-site backups for self-hosted Convex <i>and</i> Convex Cloud — with one-click restores, ransomware-proof storage and a console your whole team can use.</p>
      <div class="chips" style="margin-top:34px">
        <div class="chip">🔐 <b>age</b> encryption</div><div class="chip">🧱 S3 <b>Object Lock</b></div><div class="chip">↺ Partial & scrubbed <b>restores</b></div>
        <div class="chip">☁️ R2 · S3 · B2 · MinIO</div><div class="chip">👥 Workspaces & roles</div><div class="chip">🔑 2FA · passkeys · SSO</div>
      </div>
    </div>
    <div style="position:absolute;left:790px;top:120px;width:1020px;transform:perspective(2000px) rotateY(-14deg) rotateX(4deg);transform-origin:left center">${win(img('overview-dark'))}</div>
    <div style="position:absolute;left:1180px;top:470px;width:380px;transform:perspective(2000px) rotateY(-14deg);border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.12)">
      <img src="${img('contents-dark')}" style="width:1070px;margin-left:-768px;display:block">
    </div>`],
  'social-preview': [1280, 640, `
    <div class="bg"></div><div class="grid"></div>
    <div style="position:absolute;left:70px;top:80px;width:560px">
      <div class="pill"><img src="${logo}">Convex Backup Console</div>
      <h1 style="font-size:58px;margin-top:26px">Backups for Convex<br><span class="grad">you can restore.</span></h1>
      <p class="muted" style="font-size:20px;line-height:1.5;margin-top:22px">Self-hosted & Cloud · encrypted · scheduled · ransomware-proof · one-click restore</p>
      <div class="chips" style="margin-top:28px"><div class="chip">Deploy on <b>Coolify</b> in one click</div><div class="chip">Open source</div></div>
    </div>
    <div style="position:absolute;left:690px;top:70px;width:900px;transform:perspective(1800px) rotateY(-16deg);transform-origin:left center">${win(img('storage-dark'))}</div>`],
  'feature-restore': [1200, 700, `
    <div class="bg"></div><div class="grid"></div>
    <div style="position:absolute;left:64px;top:84px;width:420px">
      <div class="chip" style="display:inline-block">↺ Restore</div>
      <h1 style="font-size:46px;margin-top:20px">Restore exactly <span class="grad">what you need.</span></h1>
      <ul class="muted" style="font-size:18px;line-height:1.9;margin-top:22px;padding-left:20px">
        <li>Into the same or another instance</li><li>Whole snapshot or selected tables</li><li>Scrub emails & names for staging</li><li>Typed confirmation, full audit trail</li>
      </ul>
    </div>
    <div style="position:absolute;left:520px;top:50px;width:620px;height:620px;border-radius:16px;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.12)">
      <!-- dialog spans css x 464–975, y 85–815 in the 1440-wide screenshot; scale to 620px wide -->
      <img src="${img('restore')}" style="width:${1440 * 620 / 511}px;max-width:none;margin:${-85 * 620 / 511}px 0 0 ${-464 * 620 / 511}px;display:block">
    </div>`],
  'feature-storage': [1200, 700, `
    <div class="bg"></div><div class="grid"></div>
    <div style="position:absolute;left:64px;top:84px;width:420px">
      <div class="chip" style="display:inline-block">🧱 Storage</div>
      <h1 style="font-size:46px;margin-top:20px">Ransomware-proof, <span class="grad">cost-aware.</span></h1>
      <ul class="muted" style="font-size:18px;line-height:1.9;margin-top:22px;padding-left:20px">
        <li>Fan out to R2, S3, B2, MinIO & local</li><li>S3 Object Lock: undeletable for N days</li><li>7 daily · 4 weekly · 12 monthly</li><li>Usage, growth & monthly cost</li>
      </ul>
    </div>
    <div style="position:absolute;left:520px;top:90px;width:820px;transform:perspective(1800px) rotateY(-10deg);transform-origin:left center">${win(img('storage-dark'))}</div>`],
  'feature-teams': [1200, 700, `
    <div class="bg"></div><div class="grid"></div>
    <div style="position:absolute;left:64px;top:84px;width:420px">
      <div class="chip" style="display:inline-block">👥 Teams & agencies</div>
      <h1 style="font-size:46px;margin-top:20px">A workspace <span class="grad">per client.</span></h1>
      <ul class="muted" style="font-size:18px;line-height:1.9;margin-top:22px;padding-left:20px">
        <li>Own logo, timezone, keys & alerts</li><li>Owner · Admin · Operator · Viewer</li><li>Google, GitHub, Microsoft & passkeys</li><li>Mandatory 2FA, invite-only</li>
      </ul>
    </div>
    <div style="position:absolute;left:520px;top:90px;width:820px;transform:perspective(1800px) rotateY(-10deg);transform-origin:left center">${win(img('switcher'))}</div>`],
}

const browser = await chromium.launch()
for (const [name, [w, h, body]] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  await page.setContent(`<!doctype html><html><head>${base}</head><body style="width:${w}px;height:${h}px;position:relative">${body}</body></html>`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT}${name}.png` })
  await page.close()
  console.log('🎨', name)
}
await browser.close()
