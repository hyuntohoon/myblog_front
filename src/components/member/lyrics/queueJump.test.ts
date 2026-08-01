// FEAT-lyrics-viewer-playback Step 3 — pins the context jump fallback chain.
//
// The critical regression is a fallback that sends only the tapped uri: the
// Spotify `uris` form replaces playback context, so doing that silently drops
// every visible row behind it. These tests keep the full tail load-bearing.
import type { QueueEntry } from './queue.api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as playbackLib from '@lib/spotifyPlayback'
import { jumpToQueueIndex } from './queueJump'

vi.mock('@lib/spotifyPlayback', () => ({ sendPlayerCommand: vi.fn() }))

const lib = vi.mocked(playbackLib)

function entry(id: string, uri: string | null = `spotify:track:${id}`): QueueEntry {
  return { id, uri, name: id, artist: null }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('jumpToQueueIndex fallback chain', () => {
  it('uses one context jump and never calls the uris fallback when it succeeds', async () => {
    lib.sendPlayerCommand.mockResolvedValue({ ok: true })
    const items = [entry('a'), entry('b'), entry('c')]

    await expect(jumpToQueueIndex(items, 1, { uri: 'spotify:album:album1', type: 'album' }))
      .resolves
      .toEqual({ ok: true, via: 'context' })
    expect(lib.sendPlayerCommand).toHaveBeenCalledTimes(1)
    expect(lib.sendPlayerCommand).toHaveBeenCalledWith({
      kind: 'play-context',
      contextUri: 'spotify:album:album1',
      offsetUri: 'spotify:track:b',
    })
  })

  it('carries the whole visible tail after a failed context jump — never regresses to a lone track', async () => {
    lib.sendPlayerCommand
      .mockResolvedValueOnce({ ok: false, reason: 'no-capability' })
      .mockResolvedValueOnce({ ok: true })
    const items = [entry('a'), entry('b'), entry('c'), entry('d')]
    const index = 1

    await expect(jumpToQueueIndex(items, index, { uri: 'spotify:playlist:list1', type: 'playlist' }))
      .resolves
      .toEqual({ ok: true, via: 'uris' })
    expect(lib.sendPlayerCommand).toHaveBeenCalledTimes(2)
    const fallback = lib.sendPlayerCommand.mock.calls[1][0]
    expect(fallback).toEqual({
      kind: 'play-uris',
      uris: ['spotify:track:b', 'spotify:track:c', 'spotify:track:d'],
    })
    if (fallback.kind !== 'play-uris')
      throw new Error('expected uris fallback')
    expect(fallback.uris).toHaveLength(items.length - index)
  })

  it('goes straight to play-uris when there is no context', async () => {
    lib.sendPlayerCommand.mockResolvedValue({ ok: true })
    const items = [entry('a'), entry('b')]

    await expect(jumpToQueueIndex(items, 0, null)).resolves.toEqual({ ok: true, via: 'uris' })
    expect(lib.sendPlayerCommand).toHaveBeenCalledTimes(1)
    expect(lib.sendPlayerCommand).toHaveBeenCalledWith({
      kind: 'play-uris',
      uris: ['spotify:track:a', 'spotify:track:b'],
    })
  })

  it('goes straight to play-uris for a non-album/playlist context', async () => {
    lib.sendPlayerCommand.mockResolvedValue({ ok: true })
    const items = [entry('a'), entry('b')]

    await expect(jumpToQueueIndex(items, 0, { uri: 'spotify:artist:artist1', type: 'artist' }))
      .resolves
      .toEqual({ ok: true, via: 'uris' })
    expect(lib.sendPlayerCommand).toHaveBeenCalledTimes(1)
    expect(lib.sendPlayerCommand).toHaveBeenCalledWith({
      kind: 'play-uris',
      uris: ['spotify:track:a', 'spotify:track:b'],
    })
  })

  it('sends exactly the last uri when the last row is tapped', async () => {
    lib.sendPlayerCommand.mockResolvedValue({ ok: true })
    const items = [entry('a'), entry('b'), entry('c')]

    await expect(jumpToQueueIndex(items, 2, null)).resolves.toEqual({ ok: true, via: 'uris' })
    expect(lib.sendPlayerCommand).toHaveBeenCalledWith({ kind: 'play-uris', uris: ['spotify:track:c'] })
  })

  it('skips later rows without a uri while building the visible tail', async () => {
    lib.sendPlayerCommand.mockResolvedValue({ ok: true })
    const items = [entry('a'), entry('missing', null), entry('c')]

    await expect(jumpToQueueIndex(items, 0, null)).resolves.toEqual({ ok: true, via: 'uris' })
    expect(lib.sendPlayerCommand).toHaveBeenCalledWith({
      kind: 'play-uris',
      uris: ['spotify:track:a', 'spotify:track:c'],
    })
  })

  it('returns nothing-to-send and sends nothing when the tapped row has no uri', async () => {
    const items = [entry('a'), entry('missing', null), entry('c')]

    await expect(jumpToQueueIndex(items, 1, null)).resolves.toEqual({ ok: false, reason: 'nothing-to-send' })
    expect(lib.sendPlayerCommand).not.toHaveBeenCalled()
  })

  it.each(['no-capability', 'token', 'transient'] as const)(
    'maps the second link failure reason through: %s',
    async (reason) => {
      lib.sendPlayerCommand
        .mockResolvedValueOnce({ ok: false, reason: 'transient' })
        .mockResolvedValueOnce({ ok: false, reason } as never)
      const items = [entry('a'), entry('b')]

      await expect(jumpToQueueIndex(items, 0, { uri: 'spotify:album:album1', type: 'album' }))
        .resolves
        .toEqual({ ok: false, reason })
      expect(lib.sendPlayerCommand).toHaveBeenCalledTimes(2)
    },
  )
})
