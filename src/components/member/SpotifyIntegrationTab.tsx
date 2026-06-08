// Member dashboard — 연동 tab (FEAT-member-dashboard Step 3, Q16/D27; D30 validity).
//
// A thin status surface, not an OAuth flow. The refresh token is minted out-of-band
// by an admin script (scripts/spotify_bootstrap_token.py) and stored in Secrets
// Manager myblog/spotify (D27 defers the in-app PKCE flow to a later RFC). So this
// tab only reports status — no fake "연결" button (it couldn't do anything without the
// server-side OAuth handshake). D30: status reflects token *validity*, not mere
// presence — after a revoke/expire the worker flips needs_reauth and we show "재인증
// 필요" with the last-known-good time, instead of a stale "연결됨".
import { useEffect, useState } from 'react'
import { getSpotifyConnection  } from './spotify.api'
import type { SpotifyConnection } from './spotify.api'
import { SectionTitle } from './ui'

const SCOPES = ['user-read-recently-played', 'user-read-currently-playing']

type Tone = 'on' | 'warn' | 'off'

function StatusDot({ tone }: { tone: Tone }) {
  const color = tone === 'on' ? 'var(--color-accent)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-faded)'
  return (
    <span
	aria-hidden="true"
	style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        flex: '0 0 auto',
        background: color,
        boxShadow: tone === 'off' ? 'none' : `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)`,
      }}
    />
  )
}

/** Compact Korean relative time, e.g. "3시간 전". null when absent/unparseable. */
function relTime(iso: string | null): string | null {
  if (!iso)
    return null
  const t = Date.parse(iso)
  if (Number.isNaN(t))
    return null
  const sec = Math.max(0, (Date.now() - t) / 1000)
  if (sec < 60)
    return '방금 전'
  const min = Math.floor(sec / 60)
  if (min < 60)
    return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24)
    return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

function Powers() {
  return (
    <ul className="lf-sans" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {['라이브러리 · 최근 들은 앨범', '개요 · 지금 재생 중'].map(p => (
        <li key={p} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, color: 'var(--color-subtle)' }}>
          <span className="lf-mono" style={{ color: 'var(--color-accent)' }}>→</span>
          {p}
        </li>
      ))}
    </ul>
  )
}

type Status = 'connected' | 'reauth' | 'disconnected'

const COPY: Record<Status, { tone: Tone, title: string, stampLabel: string }> = {
  connected: { tone: 'on', title: 'Spotify 연결됨', stampLabel: '마지막 갱신' },
  reauth: { tone: 'warn', title: 'Spotify 재인증 필요', stampLabel: '마지막 정상 갱신' },
  disconnected: { tone: 'off', title: 'Spotify 연결 안 됨', stampLabel: '마지막 갱신' },
}

export function SpotifyIntegrationTab() {
  const [conn, setConn] = useState<SpotifyConnection | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let on = true
    getSpotifyConnection()
      .then(c => on && setConn(c))
      .catch(() => on && setErr(true))
    return () => {
      on = false
    }
  }, [])

  const status: Status | null = conn == null ?
    null :
    !conn.connected ? 'disconnected' : conn.needsReauth ? 'reauth' : 'connected'

  const stamp = conn ? relTime(conn.lastSuccessfulRefreshAt) : null

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionTitle kicker="SPOTIFY" title="연동" />

      {status == null && !err && <div className="lf-meta" style={{ padding: '8px 0' }}>상태 확인 중…</div>}
      {err && <div className="lf-panel" style={{ padding: 24, textAlign: 'center' }}><span className="lf-meta">상태 로드 실패</span></div>}

      {status != null && (
        <div className="lf-panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot tone={COPY[status].tone} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="lf-serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.1 }}>
                {COPY[status].title}
              </div>
              {stamp && (
                <div className="lf-mono" style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-faded)', marginTop: 3 }}>
                  {`${COPY[status].stampLabel} · ${stamp}`}
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 16 }}>
            <div className="lf-kicker" style={{ marginBottom: 8 }}>기능</div>
            <Powers />
          </div>

          <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 16 }}>
            <div className="lf-kicker" style={{ marginBottom: 8 }}>권한 범위 (읽기 전용)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SCOPES.map(s => (
                <code key={s} className="lf-mono lf-chip" style={{ fontSize: 11, cursor: 'default' }}>{s}</code>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SpotifyIntegrationTab
