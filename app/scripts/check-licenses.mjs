#!/usr/bin/env node
// Fails CI when a production dependency carries a licence incompatible with this project's
// AGPL-3.0-or-later code licence. Run from `app/`: `node scripts/check-licenses.mjs`.
//
// Shape of `pnpm licenses list --json --prod`: an object keyed by SPDX-ish licence string, each
// value an array of { name, versions, paths, license, author?, homepage?, description? }.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

// Licences (or substrings of a combined licence expression) that are not compatible with
// distributing this project under AGPL-3.0-or-later: source-available-but-not-open, "no commercial
// use" clauses, and copyleft licences that can't combine with the AGPL.
const INCOMPATIBLE_PATTERNS = [
  { re: /SSPL/i, reason: 'Server Side Public License is not compatible with the AGPL' },
  { re: /\bBUSL\b|Business Source License/i, reason: 'Business Source License restricts commercial use' },
  { re: /\bBSL-1\.1\b/i, reason: 'Business Source License 1.1 restricts commercial use' },
  { re: /Commons[- ]Clause/i, reason: 'Commons Clause adds a non-commercial restriction' },
  { re: /Elastic[- ]License/i, reason: 'Elastic License is source-available, not open source' },
  { re: /-NC(-|$)|NonCommercial|Non-Commercial/i, reason: 'non-commercial licences are incompatible with the AGPL' },
  { re: /GPL-2\.0-only/i, reason: 'GPL-2.0-only cannot be combined with AGPL-3.0-or-later code' },
  { re: /^UNLICENSED$/, reason: 'UNLICENSED means "all rights reserved", not usable as a dependency' },
  { re: /\bproprietary\b/i, reason: 'proprietary licences are incompatible with the AGPL' },
]

function loadAllowlist() {
  const file = path.join(__dirname, 'license-allowlist.json')
  try {
    const entries = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(entries)) throw new Error('license-allowlist.json must be a JSON array')
    return entries
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

function isAllowlisted(allowlist, pkgName, pkgVersion) {
  return allowlist.some((entry) => {
    if (entry.name !== pkgName) return false
    return !entry.version || entry.version === pkgVersion
  })
}

function main() {
  const raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  })
  const byLicense = JSON.parse(raw)
  const allowlist = loadAllowlist()

  const failures = []
  const warnings = []

  for (const [license, packages] of Object.entries(byLicense)) {
    const isUnknown = /unknown/i.test(license) || license.trim() === ''
    const incompatible = INCOMPATIBLE_PATTERNS.find(({ re }) => re.test(license))

    for (const pkg of packages) {
      if (pkg.name === rootPkg.name) continue // our own package, never flagged against itself
      for (const version of pkg.versions ?? ['?']) {
        if (isAllowlisted(allowlist, pkg.name, version)) continue

        if (incompatible) {
          failures.push({ name: pkg.name, version, license, reason: incompatible.reason })
        } else if (isUnknown) {
          warnings.push({ name: pkg.name, version, license })
        }
      }
    }
  }

  console.log(`Checked production dependency licences: ${Object.keys(byLicense).length} distinct licence(s).`)

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} package(s) with an unknown/unreported licence (not blocking):`)
    for (const w of warnings) console.log(`  - ${w.name}@${w.version} (${w.license || '<empty>'})`)
    console.log('  If these are reviewed as fine, add them to scripts/license-allowlist.json to silence this.')
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} package(s) with a licence incompatible with AGPL-3.0-or-later:`)
    for (const f of failures) console.error(`  - ${f.name}@${f.version} (${f.license}): ${f.reason}`)
    console.error(
      '\nIf this is a false positive (e.g. a dual licence where another term applies), add an entry to ' +
        'scripts/license-allowlist.json with a reason, after review.',
    )
    process.exitCode = 1
    return
  }

  console.log('\n✅ No incompatible licences found.')
}

main()
