// The point of these tests is the LAG. A stub that answers the post-command
// read correctly on the first call deletes the race this loop exists for, and
// the pre-2026-08-02 single-read code would pass every one of them. So every
// case below makes the read tell the truth only after N calls.
import { describe, expect, it, vi } from 'vitest'
import { confirmTransport } from './confirmTransport'

/**
 * A `GET /me/player` that keeps reporting `from` for `lagReads` calls after a
 * transport command, then reports `to` — the actual Spotify Connect behaviour
 * the viewer has to survive.
 */
function laggingPlayer(from: string, to: string, lagReads: number) {
  const state = { track: from, reads: 0 }
  return {
    state,
    read: async () => {
      state.reads++
      if (state.reads > lagReads)
        state.track = to
    },
    settled: () => state.track !== from,
  }
}

async function noSleep(): Promise<void> {}

describe('confirmTransport', () => {
  it('keeps reading while the player still reports the old track', async () => {
    const p = laggingPlayer('a', 'b', 2)
    const ok = await confirmTransport(p.read, p.settled, { tries: 4, gapMs: 500, sleep: noSleep })
    expect(ok).toBe(true)
    expect(p.state.track).toBe('b')
    // 2 stale reads + the one that finally disagrees.
    expect(p.state.reads).toBe(3)
  })

  it('regression guard: a single read loses this race — the loop is what fixes it', async () => {
    // One try is exactly the pre-fix ⏭ behaviour. It must fail here; if this
    // ever passes, the stub stopped modelling lag and the suite went blind.
    const p = laggingPlayer('a', 'b', 2)
    const ok = await confirmTransport(p.read, p.settled, { tries: 1, gapMs: 500, sleep: noSleep })
    expect(ok).toBe(false)
    expect(p.state.track).toBe('a')
  })

  it('stops at the first read when the player already agrees', async () => {
    const p = laggingPlayer('a', 'b', 0)
    const ok = await confirmTransport(p.read, p.settled, { tries: 4, gapMs: 500, sleep: noSleep })
    expect(ok).toBe(true)
    expect(p.state.reads).toBe(1)
  })

  it('gives up after the budget instead of reading forever', async () => {
    // A player that never applies the command (device went away mid-skip).
    const p = laggingPlayer('a', 'b', Number.MAX_SAFE_INTEGER)
    const ok = await confirmTransport(p.read, p.settled, { tries: 4, gapMs: 500, sleep: noSleep })
    expect(ok).toBe(false)
    expect(p.state.reads).toBe(4)
  })

  it('waits between attempts, but never after the last one', async () => {
    const sleep = vi.fn(async () => {})
    const p = laggingPlayer('a', 'b', Number.MAX_SAFE_INTEGER)
    await confirmTransport(p.read, p.settled, { tries: 4, gapMs: 500, sleep })
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledWith(500)
  })

  it('a skip and a jump differ only in what "settled" means', async () => {
    // Jump: settled = the player names the track we asked for.
    const jump = laggingPlayer('a', 'b', 1)
    await confirmTransport(jump.read, () => jump.state.track === 'b', { tries: 4, gapMs: 5, sleep: noSleep })
    expect(jump.state.track).toBe('b')

    // Skip: settled = the player names anything but the track we left. A skip
    // cannot know its destination, which is the whole reason for the twin.
    const skip = laggingPlayer('a', 'c', 1)
    await confirmTransport(skip.read, () => skip.state.track !== 'a', { tries: 4, gapMs: 5, sleep: noSleep })
    expect(skip.state.track).toBe('c')
  })
})
