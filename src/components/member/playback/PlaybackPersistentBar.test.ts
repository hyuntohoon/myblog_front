import type { PlaybackSessionState } from '@lib/playback/session'
import { describe, expect, it } from 'vitest'
import { isPersistentBarVisible } from './PlaybackPersistentBar'

const EMPTY_SESSION_STATE: PlaybackSessionState = {
  currentItemId: null,
  external: null,
  playing: false,
  anchor: null,
  durationMs: null,
  rung: null,
  degraded: false,
  device: null,
  capabilityTier: 'fallback',
  devices: null,
  activeDeviceId: null,
  shuffle: null,
  repeat: null,
  volumePercent: null,
  liked: 'unknown',
  reconnect: false,
  notice: null,
  busy: false,
  isOwner: false,
  ownerPresent: false,
  ownerRung: null,
}

describe('isPersistentBarVisible', () => {
  it('is hidden when nothing is sounding', () => {
    expect(isPersistentBarVisible(EMPTY_SESSION_STATE)).toBe(false)
  })

  it('is visible for a queue-matched current item, playing or paused', () => {
    expect(isPersistentBarVisible({ ...EMPTY_SESSION_STATE, currentItemId: 'item-1', playing: true })).toBe(true)
    expect(isPersistentBarVisible({ ...EMPTY_SESSION_STATE, currentItemId: 'item-1', playing: false })).toBe(true)
  })

  it('is visible for playback outside the queue (external)', () => {
    expect(isPersistentBarVisible({
      ...EMPTY_SESSION_STATE,
      external: { title: 'Song', artist: 'Artist', spotifyTrackId: 'sp-1', spotifyAlbumId: null, deviceName: null },
    })).toBe(true)
  })
})
