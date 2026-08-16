import type { PlaybackEntryHandler } from './PlaybackPanel'
import { openLiveLyrics } from '@lib/entityEvents'
import { cachedUri } from '@lib/playback/uris'

// The product has no canonical track-detail destination yet. Keep this explicit
// rather than inventing a route from the playback surfaces.
export const NOOP_PLAYBACK_ENTRY: PlaybackEntryHandler = () => {}

/** Open the one app-wide live-lyrics host from any playback surface. */
export const openPlaybackLyrics: PlaybackEntryHandler = (row, state) => {
  const spotifyTrackId = row?.trackId ?
    cachedUri(row.trackId)?.replace(/^spotify:track:/, '') ?? null :
    state.external?.spotifyTrackId ?? null
  if (!spotifyTrackId)
    return
  const anchor = state.anchor
  openLiveLyrics({
    trackId: spotifyTrackId,
    progressMs: anchor?.ms ?? null,
    progressAtMs: anchor?.wallMs ?? null,
    durationMs: state.durationMs,
    albumCoverUrl: row?.cover ?? state.external?.albumCoverUrl ?? null,
    track: row?.title ?? state.external?.title ?? null,
    artist: row?.artist ?? state.external?.artist ?? null,
    artists: [],
  })
}
