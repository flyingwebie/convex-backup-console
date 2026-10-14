import { describe, expect, it } from 'vitest'
import { parseDeployKey } from './convex.server'

describe('parseDeployKey', () => {
  it('accepts production, development and preview-deployment keys', () => {
    expect(parseDeployKey('prod:happy-otter-123|eyJ2abc')).toEqual({ type: 'prod', deploymentName: 'happy-otter-123' })
    expect(parseDeployKey('dev:quiet-fox-456|eyJ2abc')).toEqual({ type: 'dev', deploymentName: 'quiet-fox-456' })
    expect(parseDeployKey('preview:brave-cat-789|eyJ2abc')).toEqual({ type: 'preview', deploymentName: 'brave-cat-789' })
  })

  it('rejects keys that are not tied to one deployment', () => {
    expect(() => parseDeployKey('project:acme:shop|eyJ2abc')).toThrow(/project key/)
    expect(() => parseDeployKey('preview:acme:shop|eyJ2abc')).toThrow(/preview deploy key/)
  })

  it('rejects malformed input', () => {
    expect(() => parseDeployKey('not-a-key')).toThrow(/not a Convex deploy key/)
    expect(() => parseDeployKey('weird:a:b:c|x')).toThrow(/Unrecognised/)
  })
})
