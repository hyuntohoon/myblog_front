// The retry loop both transport confirmations need, extracted so it can be
// tested against a LAGGING read — which is the only way this code's bug class
// shows up at all.
//
// Spotify Connect returns 204 for `next`/`previous`/`play` before `GET
// /me/player` reflects the change, so a single post-command read is a race.
// Losing it is silent: the stale read looks like a perfectly ordinary
// same-track read, so the viewer re-anchors to the track it just left and
// never asks again. That is the bug the owner reported on 2026-08-02 for ⏭,
// and it is the same shape the queue-row jump had already solved privately.
//
// Both callers now share this loop, so the two can no longer drift apart.

/** Injected only by tests; production uses a real timer. */
export type Sleep = (ms: number) => Promise<void>

const realSleep: Sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Call `read` until `settled()` reports the command landed, or the budget runs
 * out.
 *
 * Returns whether it settled. Giving up is a normal outcome, not an error: a
 * wrong-but-current view beats suppressing reads for the rest of the session,
 * so callers clear their pending state and carry on either way.
 *
 * There is deliberately no sleep after the final attempt — the caller's
 * follow-up work (the queue re-read) should not wait out a gap it will never
 * use.
 */
export async function confirmTransport(
  read: () => Promise<void>,
  settled: () => boolean,
  { tries, gapMs, sleep = realSleep }: { tries: number, gapMs: number, sleep?: Sleep },
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    await read()
    if (settled())
      return true
    if (attempt < tries - 1)
      await sleep(gapMs)
  }
  return false
}
