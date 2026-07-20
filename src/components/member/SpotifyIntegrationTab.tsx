// Member dashboard — Spotify 연동 tab. Member OAuth now lives in the shared
// integrations contract; this surface reports the stored grant generation and
// session-only capability probes without adding a capability API or polling.
import { useEffect, useState } from 'react'
import { readSpotifyCapabilityStanding } from '@lib/spotifyCapability'
import { buildSpotifyAuthorizeUrl, getIntegrations, spotifyConnectAvailable, spotifyGrantLacksLibraryScopes, spotifyGrantNeedsReconsent, spotifyScopeGeneration } from './integrations.api'
import type { Integration, SpotifyScopeGeneration } from './integrations.api'
import { SectionTitle } from './ui'

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

const GENERATION_COPY: Record<SpotifyScopeGeneration, string> = {
  none: '없음',
  legacy: '구스코프(재생 스코프 이전)',
  playback: '재생 스코프 세대',
  library: '좋아요 스코프 세대',
}

function Powers({ connected, generation }: { connected: boolean, generation: SpotifyScopeGeneration }) {
  const modernPlayback = connected && (generation === 'playback' || generation === 'library')
  const library = connected && generation === 'library'
  const probe = readSpotifyCapabilityStanding()
  const transport = !modernPlayback ? '—' : probe.transport === 'available' ? '사용 가능(Premium 확인됨)' : probe.transport === 'no-capability' ? '제한됨(Premium/기기 상태)' : 'Premium에서 가능 · 아직 확인 전'
  const features = [
    ['스냅샷', connected ? '사용 가능' : '—'],
    ['라이브 바', connected ? '사용 가능' : '—'],
    ['재생/일시정지/seek', transport],
    ['기기 안내', modernPlayback ? '사용 가능(무료 포함)' : '—'],
    ['가사 live', connected ? '사용 가능' : '—'],
    ['다음·이전/지정 재생', transport],
    ['좋아요', library ? '사용 가능(무료 포함)' : '—'],
  ]
  return (
    <ul className="sans" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {features.map(([label, standing]) => (
        <li key={label} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, .9fr) minmax(0, 1.1fr)', gap: 10, fontSize: 12.5, color: 'var(--color-subtle)' }}>
          <span>{label}</span>
          <span style={{ color: standing === '—' ? 'var(--color-faded)' : 'var(--color-text)' }}>{standing}</span>
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
  const [conn, setConn] = useState<Integration | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let on = true
    getIntegrations().then((rows) => {
      if (on) {
        setConn(rows.find(row => row.provider === 'spotify') ?? null)
        setLoaded(true)
      }
    })
    return () => {
      on = false
    }
  }, [])

  const status: Status | null = !loaded ? null : conn == null ? 'disconnected' : conn.status === 'connected' ? 'connected' : 'reauth'
  const connected = status === 'connected'
  const generation = spotifyScopeGeneration(conn?.scope, conn != null)
  const needsPlaybackReconsent = connected && spotifyGrantNeedsReconsent(conn?.scope)
  const needsLibraryReconsent = connected && spotifyGrantLacksLibraryScopes(conn?.scope)
  const scopes = (conn?.scope ?? '').split(/\s+/).filter(Boolean)
  const probe = readSpotifyCapabilityStanding()
  const probeCopy = `컨트롤 ${probe.transport === 'available' ? '사용 가능' : probe.transport === 'no-capability' ? '제한 응답' : '확인 전'} · 좋아요 ${probe.library === 'available' ? '사용 가능' : probe.library === 'scope-missing' ? '권한 부족 응답' : '확인 전'}`

  const stamp = relTime(conn?.last_synced_at ?? null)

  const onAuthorize = () => {
    const url = buildSpotifyAuthorizeUrl()
    if (url)
      location.assign(url)
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionTitle kicker="SPOTIFY" title="연동" />

      {status == null && <div className="meta" style={{ padding: '8px 0' }}>상태 확인 중…</div>}

      {status != null && (
        <div className="panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot tone={COPY[status].tone} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.1 }}>
                {COPY[status].title}
              </div>
              {stamp && (
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-faded)', marginTop: 3 }}>
                  {`${COPY[status].stampLabel} · ${stamp}`}
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 16 }}>
            <div className="kicker" style={{ marginBottom: 8 }}>이 연동으로 열리는 기능</div>
            <div className="mono" style={{ marginBottom: 11, fontSize: 10.5, letterSpacing: '0.03em', color: 'var(--color-faded)' }}>
              {`현재 상태 · ${connected ? '연결됨' : '연결 안 됨'} · 스코프 세대 ${GENERATION_COPY[generation]} · 마지막 probe ${probeCopy}`}
            </div>
            <Powers connected={connected} generation={generation} />
            <div className="sans" style={{ marginTop: 12, borderTop: '1px solid var(--color-border-soft)', paddingTop: 10, fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-subtle)' }}>
              {generation === 'legacy' ? '재동의 한 번으로 기기 안내와 좋아요까지 열려요. 좋아요는 무료 계정도 쓸 수 있고 컨트롤만 Premium 전용이에요.' : generation === 'playback' ? '재동의하면 무료 계정에서도 가능한 좋아요가 열려요.' : connected ? '좋아요는 무료 계정도 사용할 수 있고, 재생 컨트롤만 Premium 전용이에요.' : '연동하면 라이브 바·가사·기기 안내와 좋아요가 열려요. 컨트롤은 Premium 전용이에요.'}
            </div>
          </div>

          {needsPlaybackReconsent && (
            <div className="meta" style={{ padding: '9px 10px', color: 'var(--color-accent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', textTransform: 'none' }}>
              재연동 필요 — 다시 연결하면 플레이어 컨트롤과 기기 안내를 쓸 수 있어요.
            </div>
          )}

          {needsLibraryReconsent && (
            <div className="meta" style={{ padding: '9px 10px', color: 'var(--color-accent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', textTransform: 'none' }}>
              좋아요 기능을 쓰려면 재동의가 필요해요. 무료 계정도 재동의 후 사용할 수 있어요.
            </div>
          )}

          {(status !== 'connected' || needsPlaybackReconsent || needsLibraryReconsent) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-solid" disabled={!spotifyConnectAvailable()} onClick={onAuthorize}>{conn ? '다시 연결' : 'Spotify 연결'}</button>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 16 }}>
            <div className="kicker" style={{ marginBottom: 8 }}>권한 범위</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {scopes.length === 0 && <span className="meta">저장된 권한 없음</span>}
              {scopes.map(s => (
                <code key={s} className="mono chip" style={{ fontSize: 11, cursor: 'default' }}>{s}</code>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SpotifyIntegrationTab
