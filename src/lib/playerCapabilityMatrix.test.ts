// FEAT-member-player Step 7 — pins the capability matrix.
//
// Two asymmetries here are counter-intuitive and were already stated in the RFC as
// things the product keeps getting backwards. They are cheap to reverse in a copy
// edit and expensive to notice, because the wrong answer still *renders*:
//
//   · 좋아요 and 기기 안내 work on FREE accounts. Only the transport is Premium.
//   · the transport probe and the library probe are independent — a transport
//     degrade must never take 좋아요 down with it.
//
// The third thing pinned is the reason this module exists: the help page has no
// session, so `capabilityRows(null)` must still produce a full, non-empty table.
import { describe, expect, it } from 'vitest'
import { capabilityRows, whyNoControls } from '@lib/playerCapabilityMatrix'

function probe(transport: 'available' | 'no-capability' | 'unknown', library: 'available' | 'scope-missing' | 'unknown' = 'unknown') {
  return ({ transport, library }) as never
}

const row = (rows: ReturnType<typeof capabilityRows>, id: string) => rows.find(r => r.id === id)!

describe('free-account asymmetry', () => {
  it('keeps 좋아요 and 기기 안내 ON when the transport probe says no-capability', () => {
    // A free account: controls refused, library granted. Both must survive.
    const rows = capabilityRows({
      connected: true,
      generation: 'library',
      probe: probe('no-capability', 'available'),
    })

    expect(row(rows, 'liked').on).toBe(true)
    expect(row(rows, 'device-hint').on).toBe(true)
    expect(row(rows, 'queue').on).toBe(true)
    expect(row(rows, 'queue').standing).toContain('대기열 담기 가능')
    expect(row(rows, 'transport').on).toBe(false)
  })

  it('marks the transport Premium-gated, never 좋아요', () => {
    const rows = capabilityRows({ connected: true, generation: 'library', probe: probe('no-capability', 'available') })

    expect(row(rows, 'transport').unlockedBy).toBe('premium')
    expect(row(rows, 'liked').unlockedBy).toBeNull()
  })
})

describe('scope generations', () => {
  it('a legacy grant needs re-consent for 좋아요 AND 기기 안내, not a new connect', () => {
    const rows = capabilityRows({ connected: true, generation: 'legacy', probe: probe('unknown') })

    expect(row(rows, 'liked').unlockedBy).toBe('reconsent')
    expect(row(rows, 'device-hint').unlockedBy).toBe('reconsent')
    // …but the read-only surfaces already work on a legacy grant.
    expect(row(rows, 'snapshot').on).toBe(true)
    expect(row(rows, 'lyrics-live').on).toBe(true)
  })

  it('a playback-generation grant still needs re-consent for 좋아요 only', () => {
    const rows = capabilityRows({ connected: true, generation: 'playback', probe: probe('available') })

    expect(row(rows, 'liked').on).toBe(false)
    expect(row(rows, 'liked').unlockedBy).toBe('reconsent')
    expect(row(rows, 'device-hint').on).toBe(true)
    expect(row(rows, 'transport').on).toBe(true)
  })

  it('everything is off and attributed to connect when disconnected', () => {
    const rows = capabilityRows({ connected: false, generation: 'none', probe: probe('unknown') })

    expect(rows.every(r => !r.on)).toBe(true)
    // a DISCONNECTED member's one next action really is 연동, for every row
    expect(rows.every(r => r.unlockedBy === 'connect')).toBe(true)
  })
})

describe('the sessionless help page', () => {
  it('still renders a full table with concrete requirements', () => {
    const rows = capabilityRows(null)

    expect(rows.length).toBeGreaterThan(0)
    // no row may fall back to the live-session em dash — that reads as "broken"
    expect(rows.every(r => r.standing !== '—')).toBe(true)
    expect(rows.every(r => r.what.length > 0)).toBe(true)
  })

  it('names each row\'s INHERENT gate, not a fake disconnected one', () => {
    // The bug this pins: deriving unlockedBy from `connected: false` made the help
    // page chip every row "필요 Spotify 연동", including the Premium-only ones.
    const rows = capabilityRows(null)

    expect(row(rows, 'transport').unlockedBy).toBe('premium')
    expect(row(rows, 'modes').unlockedBy).toBe('premium')
    expect(row(rows, 'queue').unlockedBy).toBe('connect')
    expect(row(rows, 'liked').unlockedBy).toBe('reconsent')
    expect(row(rows, 'snapshot').unlockedBy).toBe('connect')
  })

  it('exposes the same row ids as a live situation, so the two cannot drift', () => {
    const live = capabilityRows({ connected: true, generation: 'library', probe: probe('available', 'available') }).map(r => r.id)
    expect(capabilityRows(null).map(r => r.id)).toEqual(live)
  })

  it('describes the Buckit-owned tail, not Spotify\'s active-player queue', () => {
    const queue = row(capabilityRows(null), 'queue')

    expect(queue.label).toContain('Buckit')
    expect(queue.what).toContain('재생 중이 아니어도')
    expect(queue.what).toContain('남은 대기열')
  })
})

describe('whyNoControls — the 7b answer', () => {
  it('says nothing when controls actually work', () => {
    expect(whyNoControls({ connected: true, generation: 'library', probe: probe('available') })).toBeNull()
  })

  it('points a disconnected member at 연동, not at Premium', () => {
    const why = whyNoControls({ connected: false, generation: 'none', probe: probe('unknown') })
    expect(why?.href).toBe('/settings/')
    expect(why?.reason).toContain('연동')
  })

  it('points a legacy grant at re-connect rather than blaming Premium', () => {
    const why = whyNoControls({ connected: true, generation: 'legacy', probe: probe('unknown') })
    expect(why?.reason).toContain('예전 스코프')
    expect(why?.href).toBe('/settings/')
  })

  it('sends a refused-but-modern grant to the help page, and names BOTH likely causes', () => {
    const why = whyNoControls({ connected: true, generation: 'library', probe: probe('no-capability') })
    expect(why?.href).toBe('/help/player/')
    expect(why?.reason).toContain('Premium')
    expect(why?.reason).toContain('기기')
  })
})
