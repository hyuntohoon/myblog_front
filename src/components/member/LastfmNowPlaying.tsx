// Member dashboard — Last.fm 지금 듣기 (FEAT-multi-user-accounts Phase 3a).
//
// The member's Last.fm now-playing, read-only. Source is the worker poll
// (GET /api/integrations/lastfm/now-playing — self-scoped JWT) which keeps a row
// only while a scrobble is actively "now playing"; otherwise the endpoint returns
// is_playing=false. So the resting state is a calm idle, not the last-heard track
// (that lives in the Spotify-fed 최근 재생 widgets).
//
// States: 미연동 (→ /settings) · 연동 오류(사용자 못 찾음) · 재생 중(scrobble card)
// · 재생 중 아님(idle). Never polled; a ↻ button re-reads the cached row — a cheap
// DB read (the worker owns writes), so no enqueue like the Spotify widget's live
// one-shot. Parallel to NowPlaying.tsx (Spotify) but a distinct, self-scoped source.
//
// NB LASTFM_API_KEY is unset in prod until the owner provisions it, so the worker
// writes no rows and this widget rests on the idle / 미연동 state — by design.
import type { Integration, LastfmNowPlaying as LastfmNp } from './integrations.api'
import { useEffect, useRef, useState } from 'react'
import { getIntegrations, getLastfmNowPlaying } from './integrations.api'
import { Cover, Equalizer } from './ui'

/** Relative freshness label from an ISO timestamp ("방금" / "N분 전" / 날짜). */
function fmtSince(iso?: string | null): string {
  if (!iso)
    return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime()))
    return ''
  const mins = Math.floor((Date.now() - t.getTime()) / 60_000)
  if (mins < 1)
    return '방금'
  if (mins < 60)
    return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)
    return `${hrs}시간 전`
  return t.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

/** Fixed-size cover: real Last.fm art when a URL is present, else the letter tile. */
function LfCover({ url, label, size }: { url?: string | null, label: string, size: number }) {
  if (url) {
    return (
      <img
	src={url}
	alt={label}
	loading="lazy"
	decoding="async"
	style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4, display: 'block', flex: '0 0 auto', border: '1px solid var(--color-border)' }}
      />
    )
  }
  return <Cover label={label} size={size} radius={4} />
}

type Load = 'loading' | 'ready' | 'error'

interface State {
  load: Load
  /** The connected Last.fm integration row, or null (미연동). */
  lastfm: Integration | null
  np: LastfmNp | null
}

export function LastfmNowPlaying() {
  const [st, setSt] = useState<State>({ load: 'loading', lastfm: null, np: null })
  const [syncing, setSyncing] = useState(false)
  const alive = useRef(true)
  const busy = useRef(false)

  useEffect(() => {
    alive.current = true
    Promise.all([getIntegrations(), getLastfmNowPlaying()])
      .then(([rows, np]) => {
        if (!alive.current)
          return
        setSt({ load: 'ready', lastfm: rows.find(r => r.provider === 'lastfm') ?? null, np })
      })
      .catch(() => alive.current && setSt(s => ({ ...s, load: 'error' })))
    return () => {
      alive.current = false
    }
  }, [])

  // ↻ — re-read the cached now-playing row (the worker owns writes, so this is a
  // plain DB read, not a re-poll). Single-flight via busyRef.
  const onSync = async () => {
    if (busy.current)
      return
    busy.current = true
    setSyncing(true)
    try {
      const np = await getLastfmNowPlaying()
      if (alive.current)
        setSt(s => ({ ...s, np }))
    }
    finally {
      busy.current = false
      if (alive.current)
        setSyncing(false)
    }
  }

  if (st.load === 'loading') {
    return (
      <div className="lf-skel-stack" aria-busy="true" aria-label="불러오는 중">
        <div className="lf-skeleton" style={{ height: 56 }} />
      </div>
    )
  }

  // 미연동 — a quiet, actionable prompt (the widget is addable before connecting).
  if (!st.lastfm) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
        <p className="sans" style={{ margin: 0, fontSize: 13, color: 'var(--color-subtle)' }}>
          Last.fm이 연동되어 있지 않아요. 사용자 이름을 연결하면 지금 듣는 곡이 여기에 표시돼요.
        </p>
        <a href="/settings" className="mono" style={{ fontSize: 11, letterSpacing: '.06em', color: 'var(--color-accent)', textDecoration: 'none' }}>설정에서 연결 →</a>
      </div>
    )
  }

  const np = st.np
  const isError = st.lastfm.status === 'error'
  const playing = !!(np && np.is_playing && np.track)
  const freshness = fmtSince(st.lastfm.last_synced_at)

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, rowGap: 10 }}>
      {playing ?
        <LfCover url={np?.image_url} label={np?.album ?? np?.track ?? 'Last.fm'} size={64} /> :
        <Equalizer playing={false} h={14} />}

      <div style={{ flex: 1, minWidth: 140 }}>
        <div className="kicker" style={{ marginBottom: 4, whiteSpace: 'nowrap', color: playing ? 'var(--color-accent)' : 'var(--color-faded)' }}>
          {playing ? '● 재생 중' : 'NOW PLAYING'}
        </div>
        {playing ?
          (
            <>
              <div className="serif italic" style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{np?.track}</div>
              <div className="sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {[np?.artist, np?.album].filter(Boolean).join(' — ')}
              </div>
            </>
          ) :
          <div className="serif italic" style={{ fontSize: 17, color: 'var(--color-subtle)' }}>{isError ? '사용자를 찾지 못했어요' : '재생 중 아님'}</div>}
      </div>

      <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
        <span className="mono" style={{ fontSize: 10.5, color: isError ? 'var(--color-accent)' : 'var(--color-faded)', letterSpacing: '.04em' }}>
          {isError ? '설정에서 확인' : (freshness ? `@${st.lastfm.username} · ${freshness}` : `@${st.lastfm.username}`)}
        </span>
        <button
	type="button"
	className="iconbtn mono"
	onClick={() => { void onSync() }}
	disabled={syncing}
	aria-label="Last.fm 지금 듣기 새로고침"
	title="새로고침"
	style={{ width: 26, height: 26, fontSize: 14, lineHeight: 1, flex: '0 0 auto' }}
        >
          {syncing ? '…' : '↻'}
        </button>
      </div>
    </div>
  )
}
