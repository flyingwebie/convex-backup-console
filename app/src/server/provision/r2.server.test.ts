import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deriveR2S3Credentials } from './r2.server'

describe('deriveR2S3Credentials', () => {
  it('uses the token id as access key and hex sha256 of the value as secret', () => {
    const { accessKeyId, secretAccessKey } = deriveR2S3Credentials('tok-id', 'tok-value')
    expect(accessKeyId).toBe('tok-id')
    expect(secretAccessKey).toBe(createHash('sha256').update('tok-value').digest('hex'))
    expect(secretAccessKey).toMatch(/^[0-9a-f]{64}$/)
  })
})
