// isOwnerUser() memoizes per access token so every header/tile/tray consumer
// shares one /api/me. The defect covered here: a FAILED lookup (5xx, throttle,
// timeout → getMe() null) was memoized as `false` for the token's whole hour, so
// one cold-start error hid the owner's affordances and kept bouncing them off
// /write — read by the owner as being logged out.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OWNER_HANDLE } from '@lib/member'

const me = vi.hoisted(() => ({ getMe: vi.fn() }))
vi.mock('../components/member/me.api', () => me)
vi.mock('@lib/auth', () => ({ getAccessToken: () => 'at-1' }))

beforeEach(() => {
  vi.resetModules()
  me.getMe.mockReset()
})

describe('isOwnerUser', () => {
  it('reads a failed lookup as false but asks again on the next call', async () => {
    me.getMe.mockResolvedValueOnce(null).mockResolvedValueOnce({ handle: OWNER_HANDLE })
    const { isOwnerUser } = await import('./owner')

    expect(await isOwnerUser()).toBe(false)
    expect(await isOwnerUser()).toBe(true)
    expect(me.getMe).toHaveBeenCalledTimes(2)
  })

  it('retries after a rejected lookup too', async () => {
    me.getMe.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ handle: OWNER_HANDLE })
    const { isOwnerUser } = await import('./owner')

    expect(await isOwnerUser()).toBe(false)
    expect(await isOwnerUser()).toBe(true)
  })

  it('keeps sharing one round trip once /api/me has answered', async () => {
    me.getMe.mockResolvedValue({ handle: 'someone-else' })
    const { isOwnerUser } = await import('./owner')

    expect(await Promise.all([isOwnerUser(), isOwnerUser()])).toEqual([false, false])
    expect(await isOwnerUser()).toBe(false)
    expect(me.getMe).toHaveBeenCalledTimes(1)
  })
})
