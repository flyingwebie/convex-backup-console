import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { env } from '../env.server'

// Email clients block SVG and can't fetch from a console behind Cloudflare Access, so the
// workspace logo is converted to a PNG once and attached inline (cid:logo).

const SOURCES = ['png', 'jpg', 'svg', 'webp']

/** PNG bytes of the workspace logo (96 px tall, transparent), or null when it has none. */
export async function emailLogo(workspaceId: string): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) return null
  const dir = path.join(env.dataDir, 'logos')
  const src = SOURCES.map((ext) => path.join(dir, `${workspaceId}.${ext}`)).find((f) => fs.existsSync(f))
  if (!src) return null
  const cache = path.join(dir, `${workspaceId}.email.png`)
  const mtime = fs.statSync(src).mtimeMs
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= mtime) return fs.readFileSync(cache)
  try {
    const png = await sharp(fs.readFileSync(src), { density: 300 }).resize({ height: 96, withoutEnlargement: false }).png().toBuffer()
    fs.writeFileSync(cache, png)
    return png
  } catch (err) {
    console.error('[email] logo conversion failed:', err)
    return null
  }
}
