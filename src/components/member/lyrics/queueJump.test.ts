// FEAT-lyrics-viewer-playback Step 3 — pins the context jump fallback chain.
//
// The critical regression is a fallback that sends only the tapped uri: the
// Spotify `uris` form replaces playback context, so doing that silently drops
// every visible row behind it. These tests keep the full tail load-bearing.
import type { QueueEntry } from './queue.api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as playbackLib from '@lib/spotifyPlayback'
import { jumpToQueueIndex } from './queueJump'

vi.mock('@lib/spotifyPlayback', () => ({ play: vi.fn() }))

const lib = vi.mocked(playbackLib)

const OK = { ok: true, rung: 'remote', degraded: false, message: '' } as const
const fail = (reason: 'no-capability' | 'token' | 'transient') => ({ ok: false, reason, message: '' }) as const

function entry(id: string, uri: string | null = `spotify:track:${id}`): QueueEntry {
  return { id, uri, name: id, artist: null }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('jumpToQueueIndex fallback chain', () => {
  it('uses one context jump and never calls the uris fallback when it succeeds', async () => {
    lib.play.mockResolvedValue(OK)
    const items = [entry('a'), entry('b'), entry('c')]

    await expect(jumpToQueueIndex(items, 1, { uri: 'spotify:album:album1', type: 'album' }))
      .resolves
      .toEqual({ ok: true, via: 'context', rung: 'remote', degraded: false })
    expect(lib.play).toHaveBeenCalledTimes(1)
    expect(lib.play).toHaveBeenCalledWith({
      kind: 'context',
      contextUri: 'spotify:album:album1',
      offsetUri: 'spotify:track:b',
    })
  })

  it('carries the whole visible tail after a failed context jump — never regresses to a lone track', async () => {
    lib.play
      .mockResolvedValueOnce(fail('no-capability'))
      .mockResolvedValueOnce(OK)
    const items = [entry('a'), entry('b'), entry('c'), entry('d')]
    const index = 1

    await expect(jumpToQueueIndex(items, index, { uri: 'spotify:playlist:list1', type: 'playlist' }))
      .resolves
      .toEqual({ ok: true, via: 'uris', rung: 'remote', degraded: false })
    expect(lib.play).toHaveBeenCalledTimes(2)
    const fallback = lib.play.mock.calls[1][0]
    expect(fallback).toEqual({
      kind: 'uris',
      uris: ['spotify:track:b', 'spotify:track:c', 'spotify:track:d'],
    })
    if (fallback.kind !== 'uris')
      throw new Error('expected uris fallback')
    expect(fallback.uris).toHaveLength(items.length - index)
  })

  // The ladder's answer to "where did the sound come from" is the caller's to
  // render — the session turns it into the 음질 제한 notice and into the
  // `ownerRung` every mirror tab gates on. Dropping it here made both invisible.
  it('carries the rung the ladder landed on, not just that it landed', async () => {
    lib.play.mockResolvedValue({ ok: true, rung: 'in-page', degraded: true, message: '' })
    const items = [entry('a'), entry('b')]

    await expect(jumpToQueueIndex(items, 0, null)).resolves.toEqual({ ok: true, via: 'uris', rung: 'in-page', degraded: true })
  })

  it('goes straight to play-uris when there is no context', async () => {
    lib.play.mockResolvedValue(OK)
    const items = [entry('a'), entry('b')]

    await expect(jumpToQueueIndex(items, 0, null)).resolves.toEqual({ ok: true, via: 'uris', rung: 'remote', degraded: false })
    expect(lib.play).toHaveBeenCalledTimes(1)
    expect(lib.play).toHaveBeenCalledWith({
      kind: 'uris',
      uris: ['spotify:track:a', 'spotify:track:b'],
    })
  })

  it('goes straight to play-uris for a non-album/playlist context', async () => {
    lib.play.mockResolvedValue(OK)
    const items = [entry('a'), entry('b')]

    await expect(jumpToQueueIndex(items, 0, { uri: 'spotify:artist:artist1', type: 'artist' }))
      .resolves
      .toEqual({ ok: true, via: 'uris', rung: 'remote', degraded: false })
    expect(lib.play).toHaveBeenCalledTimes(1)
    expect(lib.play).toHaveBeenCalledWith({
      kind: 'uris',
      uris: ['spotify:track:a', 'spotify:track:b'],
    })
  })

  it('sends exactly the last uri when the last row is tapped', async () => {
    lib.play.mockResolvedValue(OK)
    const items = [entry('a'), entry('b'), entry('c')]

    await expect(jumpToQueueIndex(items, 2, null)).resolves.toEqual({ ok: true, via: 'uris', rung: 'remote', degraded: false })
    expect(lib.play).toHaveBeenCalledWith({ kind: 'uris', uris: ['spotify:track:c'] })
  })

  it('skips later rows without a uri while building the visible tail', async () => {
    lib.play.mockResolvedValue(OK)
    const items = [entry('a'), entry('missing', null), entry('c')]

    await expect(jumpToQueueIndex(items, 0, null)).resolves.toEqual({ ok: true, via: 'uris', rung: 'remote', degraded: false })
    expect(lib.play).toHaveBeenCalledWith({
      kind: 'uris',
      uris: ['spotify:track:a', 'spotify:track:c'],
    })
  })

  it('returns nothing-to-send and sends nothing when the tapped row has no uri', async () => {
    const items = [entry('a'), entry('missing', null), entry('c')]

    await expect(jumpToQueueIndex(items, 1, null)).resolves.toEqual({ ok: false, reason: 'nothing-to-send' })
    expect(lib.play).not.toHaveBeenCalled()
  })

  it.each(['no-capability', 'token', 'transient'] as const)(
    'maps the second link failure reason through: %s',
    async (reason) => {
      lib.play
        .mockResolvedValueOnce(fail('transient'))
        .mockResolvedValueOnce(fail(reason))
      const items = [entry('a'), entry('b')]

      await expect(jumpToQueueIndex(items, 0, { uri: 'spotify:album:album1', type: 'album' }))
        .resolves
        .toEqual({ ok: false, reason })
      expect(lib.play).toHaveBeenCalledTimes(2)
    },
  )
})
