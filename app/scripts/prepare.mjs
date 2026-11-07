#!/usr/bin/env node
// Runs as the `prepare` lifecycle script of `pnpm install`. Installs the repo's lefthook git
// hooks, but only when we're actually inside a git work tree with a usable `.git` — which is
// true for a normal clone or worktree checkout, but NOT true inside the Docker build (the build
// context has no `.git` at all) or any other context without git. In every other case this must
// be a harmless no-op: `pnpm install --frozen-lockfile` must never fail because of it.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(__dirname, '..')
const repoRoot = path.join(appDir, '..') // app/scripts -> app -> repo root, where lefthook.yml lives

function commandExists(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function isInsideGitWorkTree(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.toString().trim() === 'true'
  } catch {
    return false
  }
}

function main() {
  if (process.env.LEFTHOOK === '0') {
    console.log('[prepare] LEFTHOOK=0, skipping lefthook install')
    return
  }
  if (!commandExists('git') || !isInsideGitWorkTree(repoRoot)) {
    console.log('[prepare] not inside a git work tree, skipping lefthook install')
    return
  }

  const lefthookBin = path.join(
    appDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook',
  )

  try {
    execFileSync(lefthookBin, ['install'], { cwd: repoRoot, stdio: 'inherit' })
  } catch (err) {
    // Never fail `pnpm install` over hook installation (e.g. read-only filesystem, CI sandboxing).
    console.warn(`[prepare] lefthook install failed, continuing without hooks: ${err.message}`)
  }
}

main()
