#!/usr/bin/env node
// Validates a commit message against this project's Gitmoji + Conventional Commits convention
// (see CONTRIBUTING.md#conventions), e.g. "✨ feat(emails): add reply-to per workspace" or
// "🐛 fix(restore): keep unselected tables". Used as lefthook's commit-msg hook, and unit-tested
// in check-commit-msg.test.mjs.
//
// Format of the first line: <emoji> <type>[(<scope>)][!]: <subject>
// Merge commits ("Merge ...") and revert commits ("Revert ...") are always allowed, matching
// what git and GitHub generate automatically.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
]

// \p{Extended_Pictographic} covers emoji (including Gitmoji's set); ️ is the variation
// selector some emoji renderers append, and some emoji are composed of multiple pictographic
// code points (e.g. family emoji) joined by ZWJ (‍).
const EMOJI_RE = /^\p{Extended_Pictographic}(?:(?:\uFE0F?\u200D|\uFE0F)\p{Extended_Pictographic})*\uFE0F?/u

const CONVENTIONAL_RE = new RegExp(`^(${CONVENTIONAL_TYPES.join('|')})(\\([-\\w./ ]+\\))?!?: .+`)

const AUTO_GENERATED_RE = /^(Merge |Revert ")/

/**
 * @param {string} message full commit message (first line is what matters)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateCommitMessage(message) {
  const firstLine = (message ?? '').split('\n')[0].trim()

  if (firstLine === '') {
    return { valid: false, reason: 'commit message is empty' }
  }
  if (AUTO_GENERATED_RE.test(firstLine)) {
    return { valid: true }
  }

  const emojiMatch = firstLine.match(EMOJI_RE)
  if (!emojiMatch) {
    return {
      valid: false,
      reason: 'must start with a Gitmoji, e.g. "✨ feat(scope): subject" — see https://gitmoji.dev',
    }
  }

  const rest = firstLine.slice(emojiMatch[0].length).trim()
  if (!CONVENTIONAL_RE.test(rest)) {
    return {
      valid: false,
      reason:
        `expected "<emoji> <type>(<scope>)?: <subject>" with type one of ${CONVENTIONAL_TYPES.join(', ')} ` +
        `(got "${firstLine}")`,
    }
  }

  return { valid: true }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: check-commit-msg.mjs <path-to-commit-message-file>')
    process.exitCode = 2
    return
  }

  const { readFile } = await import('node:fs/promises')
  const message = await readFile(file, 'utf8')
  const result = validateCommitMessage(message)

  if (!result.valid) {
    console.error(`❌ Invalid commit message: ${result.reason}`)
    console.error('   Format: Gitmoji + Conventional Commits, e.g. "✨ feat(emails): add reply-to per workspace"')
    console.error('   See CONTRIBUTING.md#conventions. Skip with LEFTHOOK=0 in an emergency.')
    process.exitCode = 1
    return
  }
}

// Only run the CLI when invoked directly (not when imported by the test file).
// Compare real paths so symlinks, spaces and Windows drive letters don't hide the hook's failures.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
