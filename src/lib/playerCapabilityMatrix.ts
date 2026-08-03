// FEAT-member-player Step 7 — the user-facing capability matrix, in ONE place.
//
// The RFC's rule for Step 7 is that the matrix is the single source and every
// surface regenerates from it. When 7a shipped there was one consumer, so the rows
// were hand-rolled inside `SpotifyIntegrationTab`; `SettingsApp` then grew its own
// copy, and the two had already drifted — one says '스냅샷', the other says
// '최근 재생 스냅샷' for the same capability. 7b and 7c would have made that four
// copies, so the rows move here first and the surfaces become renderers.
//
// This module is deliberately pure data + derivation: no React, no fetching. The
// help page (7c) is prerendered and cannot read a live session, so it renders the
// same rows with `situation: null` — one code path, two audiences.
import type { SpotifyCapabilityStanding } from '@lib/spotifyCapability'
import type { SpotifyScopeGeneration } from '@components/member/integrations.api'

/** Everything the matrix needs to know about one member, right now. */
export interface CapabilitySituation {
  connected: boolean
  generation: SpotifyScopeGeneration
  probe: SpotifyCapabilityStanding
}

export interface CapabilityRow {
  /** Stable id — what a caller filters on, so copy edits never break a filter. */
  id: 'snapshot' | 'live-bar' | 'transport' | 'device-hint' | 'lyrics-live' | 'skip-play' | 'liked' | 'queue' | 'modes'
  label: string
  /** What this member gets today. */
  standing: string
  /** True when it actually works right now — drives the muted/normal styling. */
  on: boolean
  /** Audience-neutral description for the help page, independent of any session. */
  what: string
  /**
   * What unlocks it. For a live situation this is what THIS member should do next;
   * with no situation it is the capability's inherent gate.
   *
   * Getting this right matters more than it looks: computing it from a fake
   * "disconnected" state made the sessionless help page label every row
   * "필요 Spotify 연동", including the Premium-only ones. Null once it is on.
   */
  unlockedBy: 'connect' | 'reconsent' | 'premium' | null
}

export const SCOPE_GENERATION_COPY: Record<SpotifyScopeGeneration, string> = {
  none: '없음',
  legacy: '구스코프(재생 스코프 이전)',
  playback: '재생 스코프 세대',
  library: '좋아요 스코프 세대',
}

/**
 * The rows for a given situation — or the generic rows when `situation` is null
 * (the prerendered help page, which has no session to read).
 *
 * Two asymmetries this table exists to keep honest, both easy to get backwards:
 *   · 좋아요 and 기기 안내 work on FREE accounts. Only the transport is Premium.
 *   · the transport probe is separate from the library probe, so a transport
 *     degrade must never hide 좋아요.
 */
export function capabilityRows(situation: CapabilitySituation | null): CapabilityRow[] {
  const connected = situation?.connected ?? false
  const generation = situation?.generation ?? 'none'
  const probe = situation?.probe
  const modernPlayback = connected && (generation === 'playback' || generation === 'library')
  const library = connected && generation === 'library'

  const transportStanding = !situation ?
    'Spotify Premium 필요' :
    !modernPlayback ?
      '—' :
      probe?.transport === 'available' ?
        '사용 가능(Premium 확인됨)' :
        probe?.transport === 'no-capability' ?
          '제한됨(Premium/기기 상태)' :
          'Premium에서 가능 · 아직 확인 전'
  const transportOn = !!situation && modernPlayback && probe?.transport === 'available'

  const generic = (on: boolean, need: string) => (situation ? (on ? '사용 가능' : '—') : need)

  return [
    {
      id: 'snapshot',
      label: '최근 재생 스냅샷',
      standing: generic(connected, 'Spotify 또는 Last.fm 연동 필요'),
      on: connected,
      what: '마지막으로 들은 곡을 카드에 보여줍니다. 표시 전용이에요.',
      unlockedBy: !situation ? 'connect' : connected ? null : 'connect',
    },
    {
      id: 'live-bar',
      label: '라이브 바',
      standing: generic(connected, 'Spotify 연동 필요'),
      on: connected,
      what: '지금 재생 중인 곡과 진행 위치를 실시간에 가깝게 보여줍니다.',
      unlockedBy: !situation ? 'connect' : connected ? null : 'connect',
    },
    {
      id: 'lyrics-live',
      label: '가사 live',
      standing: generic(connected, 'Spotify 연동 필요'),
      on: connected,
      what: '재생 위치에 맞춰 가사가 따라 흐릅니다.',
      unlockedBy: !situation ? 'connect' : connected ? null : 'connect',
    },
    {
      id: 'device-hint',
      label: '기기 안내 · 기기 전환',
      // On the sessionless page this must not read as "재동의 필요 없음" while the
      // 필요 chip below it says Spotify 연동 — the two together looked contradictory
      // in the 7c render. State the requirement, then the free-account exemption.
      standing: !situation ? 'Spotify 연동 필요 · 무료 계정 가능' : modernPlayback ? '사용 가능(무료 포함)' : '—',
      on: modernPlayback,
      what: '어느 기기에서 재생 중인지 보여주고, 눌러서 다른 기기로 옮깁니다.',
      unlockedBy: !situation ? 'connect' : modernPlayback ? null : connected ? 'reconsent' : 'connect',
    },
    {
      id: 'transport',
      label: '재생/일시정지/seek',
      standing: transportStanding,
      on: transportOn,
      what: '플레이어 바에서 직접 재생을 조작합니다.',
      unlockedBy: !situation ? 'premium' : transportOn ? null : !connected ? 'connect' : !modernPlayback ? 'reconsent' : 'premium',
    },
    {
      id: 'skip-play',
      label: '다음·이전 / 지정 재생',
      standing: transportStanding,
      on: transportOn,
      what: '곡을 넘기고, 앨범이나 트랙을 골라 바로 재생합니다.',
      unlockedBy: !situation ? 'premium' : transportOn ? null : !connected ? 'connect' : !modernPlayback ? 'reconsent' : 'premium',
    },
    {
      id: 'queue',
      label: 'Buckit 재생 대기열',
      standing: !situation ?
        'Spotify 연동 필요 · 재생 제어는 Premium' :
        !modernPlayback ?
          '—' :
          transportOn ?
            '대기열 · 재생 사용 가능' :
            '대기열 담기 가능 · 재생 제어 제한',
      on: modernPlayback,
      what: 'Playback Bucket에 곡을 순서대로 담습니다. 재생 중이 아니어도 추가할 수 있고, 고른 곡부터 Buckit의 남은 대기열을 이어 재생합니다.',
      unlockedBy: !situation ? 'connect' : modernPlayback ? null : connected ? 'reconsent' : 'connect',
    },
    {
      id: 'modes',
      label: '셔플 · 반복 · 볼륨',
      standing: !situation ? 'Spotify Premium · 기기에 따라 다름' : transportOn ? '사용 가능(볼륨은 기기에 따라)' : transportStanding,
      on: transportOn,
      what: '셔플과 반복을 바꿉니다. 볼륨은 기기가 지원할 때만 나타나요.',
      unlockedBy: !situation ? 'premium' : transportOn ? null : !connected ? 'connect' : !modernPlayback ? 'reconsent' : 'premium',
    },
    {
      id: 'liked',
      label: '좋아요',
      standing: !situation ? '재동의 필요 · 무료 계정 가능' : library ? '사용 가능(무료 포함)' : '—',
      on: library,
      what: 'Spotify의 좋아요(Liked Songs)에 넣고 뺍니다. 무료 계정도 됩니다.',
      unlockedBy: !situation ? 'reconsent' : library ? null : connected ? 'reconsent' : 'connect',
    },
  ]
}

/** One line naming the member's standing, shared by both integration surfaces. */
export function standingLine(situation: CapabilitySituation): string {
  const probeCopy = [
    `컨트롤 ${situation.probe.transport === 'available' ? '사용 가능' : situation.probe.transport === 'no-capability' ? '제한 응답' : '확인 전'}`,
    `좋아요 ${situation.probe.library === 'available' ? '사용 가능' : situation.probe.library === 'scope-missing' ? '권한 부족 응답' : '확인 전'}`,
  ].join(' · ')
  return `현재 상태 · ${situation.connected ? '연결됨' : '연결 안 됨'} · 스코프 세대 ${SCOPE_GENERATION_COPY[situation.generation]} · 마지막 probe ${probeCopy}`
}

/**
 * Why the transport controls are missing, for the member looking at a bar that has
 * none (7b). Returns null when they are not missing — the caller renders nothing.
 *
 * Deliberately answers the question the member actually asks ("왜 안 보이지"), which
 * is not the same as listing capabilities: it names the ONE next action.
 */
export function whyNoControls(situation: CapabilitySituation): { reason: string, action: string, href?: string } | null {
  const modernPlayback = situation.connected && (situation.generation === 'playback' || situation.generation === 'library')
  if (!situation.connected)
    return { reason: 'Spotify가 연동되어 있지 않아요.', action: '설정에서 연동하기', href: '/settings/' }
  if (!modernPlayback)
    return { reason: '지금 권한으로는 재생을 조작할 수 없어요. 예전 스코프로 연결되어 있어요.', action: '설정에서 다시 연결하기', href: '/settings/' }
  if (situation.probe.transport === 'no-capability') {
    return {
      reason: 'Spotify가 컨트롤을 거절했어요. 보통 Premium이 아니거나, 조작할 수 있는 기기가 없을 때예요.',
      action: '기능별 조건 보기',
      href: '/help/player/',
    }
  }
  return null
}
