import { describe, expect, it } from 'vitest'
import { openAlbumUnresolved } from './entityEvents'

describe('openAlbumUnresolved', () => {
  it('pairs the Spotify fallback id with the unresolved marker', () => {
    expect(openAlbumUnresolved('spotify-album-1', {
      title: 'Fallback album',
      artist: 'Fallback artist',
      cover: null,
      year: 2026,
    })).toEqual({
      albumId: 'spotify-album-1',
      unresolved: true,
      title: 'Fallback album',
      artist: 'Fallback artist',
      cover: null,
      year: 2026,
    })
  })
})
