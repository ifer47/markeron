import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildAfdianRequest, resolveSponsorDisplayName, signAfdianRequest } from './sync-afdian-sponsors.mjs'

describe('sync-afdian-sponsors', () => {
  it('signs requests with Afdian md5 scheme', () => {
    const body = {
      user_id: 'user123',
      params: '{"page":1}',
      ts: 1700000000,
    }
    const sign = signAfdianRequest('token456', body)
    assert.match(sign, /^[a-f0-9]{32}$/)
    assert.equal(sign, signAfdianRequest('token456', body))
  })

  it('builds request payload with stringified params', () => {
    const body = buildAfdianRequest('user123', { page: 2 })
    assert.equal(body.user_id, 'user123')
    assert.equal(body.params, '{"page":2}')
    assert.equal(typeof body.ts, 'number')
  })

  it('prefers order display name over sponsor profile name', () => {
    assert.equal(resolveSponsorDisplayName('爱发电用户_36106', '47'), '47')
    assert.equal(resolveSponsorDisplayName('Alice', '47'), '47')
    assert.equal(resolveSponsorDisplayName('Alice', ''), 'Alice')
    assert.equal(resolveSponsorDisplayName('', '47'), '47')
    assert.equal(resolveSponsorDisplayName('', ''), '')
  })
})
