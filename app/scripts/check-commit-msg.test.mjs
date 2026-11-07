import { describe, expect, it } from 'vitest'
import { validateCommitMessage } from './check-commit-msg.mjs'

describe('validateCommitMessage', () => {
  it('accepts a well-formed feat commit', () => {
    expect(validateCommitMessage('✨ feat(emails): add reply-to per workspace')).toEqual({ valid: true })
  })

  it('accepts a well-formed fix commit', () => {
    expect(validateCommitMessage('🐛 fix(restore): keep unselected tables')).toEqual({ valid: true })
  })

  it('accepts an emoji followed by a variation selector', () => {
    expect(validateCommitMessage('♻️ refactor: tidy the retention helpers')).toEqual({ valid: true })
  })

  it('accepts a commit with no scope', () => {
    expect(validateCommitMessage('🔧 chore: bump dependencies')).toEqual({ valid: true })
  })

  it('accepts a breaking-change marker', () => {
    expect(validateCommitMessage('✨ feat(api)!: drop legacy restore endpoint')).toEqual({ valid: true })
  })

  it('accepts a multi-line commit message, checking only the first line', () => {
    expect(validateCommitMessage('✨ feat(emails): add reply-to per workspace\n\nLonger body here.')).toEqual({
      valid: true,
    })
  })

  it('accepts a merge commit unmodified', () => {
    expect(validateCommitMessage("Merge pull request #7 from flyingwebie/feat/restore-live-log")).toEqual({
      valid: true,
    })
  })

  it('accepts a revert commit unmodified', () => {
    expect(validateCommitMessage('Revert "✨ feat(emails): add reply-to per workspace"')).toEqual({ valid: true })
  })

  it('rejects a commit missing the emoji', () => {
    const result = validateCommitMessage('feat(emails): add reply-to per workspace')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Gitmoji/)
  })

  it('rejects a commit with an unknown type', () => {
    const result = validateCommitMessage('✨ feature(emails): add reply-to per workspace')
    expect(result.valid).toBe(false)
  })

  it('rejects a commit missing the colon', () => {
    const result = validateCommitMessage('✨ feat(emails) add reply-to per workspace')
    expect(result.valid).toBe(false)
  })

  it('rejects an empty commit message', () => {
    expect(validateCommitMessage('').valid).toBe(false)
    expect(validateCommitMessage('   ').valid).toBe(false)
  })

  it('rejects a commit with emoji but no subject after the colon', () => {
    const result = validateCommitMessage('✨ feat(emails):')
    expect(result.valid).toBe(false)
  })
})
