import type { PlaybackEntryHandler } from './PlaybackPanel'
import type { LivePlayback } from '@components/member/lyrics/playback.api'
import { readLivePlayback } from '@components/member/lyrics/playback.api'
import { openLiveLyrics } from '@lib/entityEvents'
import { providerStore } from '@lib/playback/provider'
import { playbackSession } from '@lib/playback/session'
import { cachedUri, resolveUri } from '@lib/playback/uris'

/**
 * OPS-project-stabilization Step 2A (finding A5) — what is playing NOW, asked once
 * at the press.
 *
 * The button used to open whatever the session last stored. On a page that had
 * been open a while, with the song changed on a phone, that was the previous
 * song's lyrics — and the viewer trusts its entry, so nothing corrected it until
 * that song's estimated end. One read per press is 1:1 with a member action (not
 * polling), and it goes through the session so the Global Player moves with it.
 *
 * Returns null when there is no fresh answer to use: the read failed, or the
 * session is itself settling a command or a boundary and owns the answer. The
 * caller then falls back to what the session holds, which is what it did before.
 */
async function freshObservation(): Promise<Exclude<LivePlayback, { state: 'unavailable' }> | null> {
  const o = await playbackSession.observeLive()
  // A mirror may not adopt; it reads for itself, as the viewer does.
  const live = o.k === 'adopted' ? o.live : o.k === 'mirror' ? await readLivePlayback() : null
  return live == null || live.state === 'unavailable' ? null : live
}

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
    if (providerStore.getSnapshot().provider !== 'youtube') {
      const before = providerStore.getSnapshot()
      const live = await freshObservation()
      // A provider switch during the read makes this answer someone else's.
      if (providerStore.getSnapshot() !== before)
        return
      if (live?.state === 'idle')
        return
      if (live?.state === 'playing' || live?.state === 'paused') {
        openLiveLyrics({
          trackId: live.trackId,
          progressMs: live.progressMs,
          progressAtMs: live.readAtMs,
          durationMs: live.durationMs,
          albumCoverUrl: live.albumCoverUrl,
          track: live.track,
          artist: live.artist,
          artists: live.artists,
        })
        return
      }
      // No fresh answer: open what the session holds now, not what it held at the press.
      await openFromSession(playbackSession.currentRow(), playbackSession.getSnapshot())
      return
    }
    await openFromSession(row, state)
  })()
}

/** The entry as it was before finding A5: the session's stored identity. */
async function openFromSession(...[row, state]: Parameters<PlaybackEntryHandler>): Promise<void> {
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
}
