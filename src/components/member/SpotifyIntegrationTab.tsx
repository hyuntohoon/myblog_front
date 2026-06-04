// Member dashboard — 연동 tab (FEAT-member-dashboard Step 3, Q16/D27).
//
// A thin status surface, not an OAuth flow. The refresh token is minted out-of-band
// by an admin script (scripts/spotify_bootstrap_token.py) and stored in Secrets
// Manager myblog/spotify (D27 defers the in-app PKCE flow to a later RFC). So this
// tab only reports whether a token is present and what it powers — no fake "연결"
// button (it couldn't do anything without the server-side OAuth handshake).
import { useEffect, useState } from 'react'
import { getSpotifyConnection } from './spotify.api'
import { SectionTitle } from './ui'

const SCOPES = ['user-read-recently-played', 'user-read-currently-playing']

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
	aria-hidden="true"
	style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        flex: '0 0 auto',
        background: on ? 'var(--color-accent)' : 'var(--color-faded)',
        boxShadow: on ? '0 0 0 4px color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'none',
      }}
    />
  )
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

export function SpotifyIntegrationTab() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let on = true
    getSpotifyConnection()
      .then(c => on && setConnected(c))
      .catch(() => on && setErr(true))
    return () => {
      on = false
    }
  }, [])

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionTitle kicker="SPOTIFY" title="연동" />

      {connected == null && !err && <div className="lf-meta" style={{ padding: '8px 0' }}>상태 확인 중…</div>}
      {err && <div className="lf-panel" style={{ padding: 24, textAlign: 'center' }}><span className="lf-meta">연동 상태를 불러오지 못했습니다</span></div>}

      {connected != null && (
        <div className="lf-panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot on={connected} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="lf-serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.1 }}>
                {connected ? 'Spotify 연결됨' : 'Spotify 연결 안 됨'}
              </div>
              <div className="lf-mono" style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-subtle)', marginTop: 4 }}>
                {connected ? '청취 기록을 동기화하는 중' : '리프레시 토큰이 아직 등록되지 않았습니다'}
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 16 }}>
            <div className="lf-kicker" style={{ marginBottom: 8 }}>이 연동이 제공하는 것</div>
            <Powers />
          </div>

          <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 16 }}>
            <div className="lf-kicker" style={{ marginBottom: 8 }}>권한 범위 (읽기 전용)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SCOPES.map(s => (
                <code key={s} className="lf-mono lf-chip" style={{ fontSize: 11, cursor: 'default' }}>{s}</code>
              ))}
            </div>
            <p className="lf-sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', lineHeight: 1.6, margin: '12px 0 0' }}>
              재생 제어·저장 등 쓰기 권한은 요청하지 않습니다(읽기 전용).
            </p>
          </div>

          {!connected && (
            <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 16 }}>
              <p className="lf-sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)', lineHeight: 1.6, margin: 0 }}>
                관리자가
                {' '}
                <code className="lf-mono" style={{ fontSize: 11.5 }}>scripts/spotify_bootstrap_token.py</code>
                {' '}
                를 1회 실행해 리프레시 토큰을 발급하면 자동으로 연결됩니다. 인앱 연결 흐름은 후속 단계에서 추가될 예정입니다.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SpotifyIntegrationTab
