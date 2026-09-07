import type { PlaybackEntryHandler } from './PlaybackPanel'
import { openLiveLyrics } from '@lib/entityEvents'
import { providerStore } from '@lib/playback/provider'
import { playbackSession } from '@lib/playback/session'
import { cachedUri, resolveUri } from '@lib/playback/uris'

/**
 * Open the one app-wide live-lyrics host from any playback surface.
 *
 * G1 (ARCH-playback-authority-convergence Step 3). This used to read
 * `cachedUri(row.trackId)` and `return` on a miss — so whether 가사 did anything
 * at all depended on whether the panel's idle prefetch happened to have run for
 * this row yet. Pressing it twice "fixed" it, which is the signature of a silent
 * failure rather than a missing feature.
 *
 * Now: the cache is still consulted first (a warm row opens with no request at
 * all), a miss RESOLVES, and a resolution that fails says so on the session's own
 * notice channel instead of doing nothing.
 */
export const openPlaybackLyrics: PlaybackEntryHandler = (row, state) => {
  void (async () => {
    const started = playbackSession.getSnapshot()
    const provider = providerStore.getSnapshot()
    const catalogTrackId = provider.provider === 'youtube' ? provider.trackId : row?.trackId
    let spotifyTrackId = provider.provider === 'youtube' ? null : state.external?.spotifyTrackId ?? null
    if (catalogTrackId) {
      // `cachedUri` returns `undefined` for "never asked" and `null` for "asked and
      // it does not resolve". Only the first is worth a request; `resolveUri`
      // memoises the second, so re-asking would spend a round trip to be told the
      // same thing. That memoised `null` is now DURABLE-ONLY — F1 shipped in Step
      // 1, not Step 4 as this comment used to claim: a 500 or a dropped
      // connection is no longer remembered at all, so re-asking is not skipped
      // for a track whose resolve merely failed once.
      const cached = cachedUri(catalogTrackId)
      const uri = cached === undefined ? await resolveUri(catalogTrackId) : cached
      spotifyTrackId = uri?.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : null
    }
    const live = playbackSession.getSnapshot()
    const currentProvider = providerStore.getSnapshot()
    // URI resolution must never pair an old song with the new song's clock.
    const providerChanged = currentProvider.provider !== provider.provider || currentProvider.trackId !== provider.trackId || currentProvider.videoId !== provider.videoId
    const spotifyTrackChanged = provider.provider === 'spotify' && (live.currentItemId !== started.currentItemId || live.external?.spotifyTrackId !== started.external?.spotifyTrackId)
    if (providerChanged || spotifyTrackChanged)
      return
    if (!spotifyTrackId) {
      playbackSession.reportNotice({
        tone: 'error',
        message: '이 곡의 가사를 열 수 없어요. Spotify에서 트랙을 찾지 못했어요',
        reason: 'unresolvable',
      })
      return
    }
    // Read AFTER the await: on a cache miss the resolve costs a round trip, and
    // the playhead this seeds the viewer's clock with has to be the one from the
    // moment the viewer opens, not from the moment the button was pressed.
    const anchor = live.anchor ?? state.anchor
    openLiveLyrics({
      trackId: spotifyTrackId,
      progressMs: anchor?.ms ?? null,
      progressAtMs: anchor?.wallMs ?? null,
      durationMs: live.durationMs ?? state.durationMs,
      albumCoverUrl: row?.cover ?? state.external?.albumCoverUrl ?? null,
      track: row?.title ?? state.external?.title ?? null,
      artist: row?.artist ?? state.external?.artist ?? null,
      artists: [],
    })
  })()
}
