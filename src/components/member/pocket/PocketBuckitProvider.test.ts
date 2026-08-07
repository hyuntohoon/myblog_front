import type { BoardBucket } from '@lib/buckets'
import { describe, expect, it, vi } from 'vitest'
import { PLAYBACK_KIND, PLAYBACK_TYPE, SLIB_KIND } from '@lib/buckets'
import { completeExternalAlbumDrop } from '@lib/pocketBuckit/externalAlbumDrop'

function bucket(patch: Partial<BoardBucket> = {}): BoardBucket {
  return {
    id: 'bucket-1',
    name: 'Pocket',
    color: null,
    isDone: false,
    kind: 'review',
    type: 'general',
    isPublic: false,
    researchMode: 'off',
    albums: [],
    children: [],
    ...patch,
  }
}

function ops() {
  return {
    addAlbum: vi.fn().mockResolvedValue({ conflict: false }),
    expandArtists: vi.fn().mockResolvedValue({ added: [{}] }),
    expandTracks: vi.fn().mockResolvedValue([{}, {}]),
  }
}

describe('completeExternalAlbumDrop', () => {
  it('copies a catalog album into a general Pocket bucket', async () => {
    const api = ops()
    await expect(completeExternalAlbumDrop(bucket(), 'album-1', 'Album One', api)).resolves.toBe('Album One 담음')
    expect(api.addAlbum).toHaveBeenCalledWith('bucket-1', 'album-1')
    expect(api.expandArtists).not.toHaveBeenCalled()
    expect(api.expandTracks).not.toHaveBeenCalled()
  })

  it('uses the existing source-expansion contracts for artist and playback buckets', async () => {
    const artistApi = ops()
    await completeExternalAlbumDrop(bucket({ type: 'artist' }), 'album-1', 'Album One', artistApi)
    expect(artistApi.expandArtists).toHaveBeenCalledWith('bucket-1', { albumId: 'album-1' })
    expect(artistApi.addAlbum).not.toHaveBeenCalled()

    const playbackApi = ops()
    await completeExternalAlbumDrop(bucket({ kind: PLAYBACK_KIND, type: PLAYBACK_TYPE }), 'album-1', 'Album One', playbackApi)
    expect(playbackApi.expandTracks).toHaveBeenCalledWith('bucket-1', 'album-1')
    expect(playbackApi.addAlbum).not.toHaveBeenCalled()
  })

  it('refuses the sync-owned Spotify library target', async () => {
    const api = ops()
    await expect(completeExternalAlbumDrop(bucket({ kind: SLIB_KIND }), 'album-1', 'Album One', api)).resolves.toBeNull()
    expect(api.addAlbum).not.toHaveBeenCalled()
    expect(api.expandArtists).not.toHaveBeenCalled()
    expect(api.expandTracks).not.toHaveBeenCalled()
  })
})
