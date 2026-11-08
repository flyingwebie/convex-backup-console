import { describe, expect, it } from 'vitest'
import { buildAwsBucketPolicy, buildR2LockRule, iamUserName, r2BucketResourceKey, r2Endpoint, r2TokenName, validateBucketName } from './helpers'

describe('validateBucketName', () => {
  it('accepts a normal name for both providers', () => {
    expect(validateBucketName('aws', 'my-backups-2026')).toBeNull()
    expect(validateBucketName('r2', 'my-backups-2026')).toBeNull()
  })
  it('rejects names that are too short or too long', () => {
    expect(validateBucketName('aws', 'ab')).not.toBeNull()
    expect(validateBucketName('aws', 'a'.repeat(64))).not.toBeNull()
  })
  it('rejects uppercase and invalid characters', () => {
    expect(validateBucketName('aws', 'My-Bucket')).not.toBeNull()
    expect(validateBucketName('r2', 'bucket_name')).not.toBeNull()
  })
  it('rejects names that start or end with a hyphen or dot', () => {
    expect(validateBucketName('aws', '-bucket')).not.toBeNull()
    expect(validateBucketName('aws', 'bucket-')).not.toBeNull()
    expect(validateBucketName('r2', '-bucket')).not.toBeNull()
  })
  it('rejects AWS-specific invalid forms', () => {
    expect(validateBucketName('aws', '192.168.1.1')).not.toBeNull()
    expect(validateBucketName('aws', 'xn--bucket')).not.toBeNull()
    expect(validateBucketName('aws', 'bucket..name')).not.toBeNull()
    expect(validateBucketName('aws', 'my-bucket-s3alias')).not.toBeNull()
  })
  it('rejects dots for R2 (not allowed there)', () => {
    expect(validateBucketName('r2', 'my.bucket')).not.toBeNull()
  })
})

describe('iamUserName / r2TokenName', () => {
  it('produces a stable, bounded, sanitized name', () => {
    expect(iamUserName('my-bucket')).toBe('convex-backup-my-bucket')
    expect(iamUserName('Weird Bucket!!')).toBe('convex-backup-Weird-Bucket--')
    expect(iamUserName('x'.repeat(100)).length).toBeLessThanOrEqual(64)
  })
  it('r2TokenName stays under a sane bound', () => {
    expect(r2TokenName('bucket').startsWith('convex-backup-')).toBe(true)
    expect(r2TokenName('x'.repeat(200)).length).toBeLessThanOrEqual(104)
  })
})

describe('buildAwsBucketPolicy', () => {
  it('scopes bucket-level and object-level actions to the right ARNs', () => {
    const policy = buildAwsBucketPolicy('my-bucket')
    expect(policy.Statement[0].Resource).toBe('arn:aws:s3:::my-bucket')
    expect(policy.Statement[1].Resource).toBe('arn:aws:s3:::my-bucket/*')
    expect(policy.Statement[0].Action).toContain('s3:ListBucket')
    expect(policy.Statement[1].Action).toContain('s3:PutObject')
    expect(policy.Statement[1].Action).toContain('s3:PutObjectRetention')
  })
})

describe('r2BucketResourceKey / r2Endpoint', () => {
  it('builds the default-jurisdiction resource key and endpoint', () => {
    expect(r2BucketResourceKey('acct123', 'my-bucket')).toBe('com.cloudflare.edge.r2.bucket.acct123_default_my-bucket')
    expect(r2Endpoint('acct123')).toBe('https://acct123.r2.cloudflarestorage.com')
  })
  it('builds the eu-jurisdiction resource key and endpoint', () => {
    expect(r2BucketResourceKey('acct123', 'my-bucket', 'eu')).toBe('com.cloudflare.edge.r2.bucket.acct123_eu_my-bucket')
    expect(r2Endpoint('acct123', 'eu')).toBe('https://acct123.eu.r2.cloudflarestorage.com')
  })
})

describe('buildR2LockRule', () => {
  it('converts days to seconds', () => {
    expect(buildR2LockRule(7)).toEqual({ rules: [{ id: 'convex-backup-lock', enabled: true, condition: { type: 'Age', maxAgeSeconds: 604_800 } }] })
  })
})
