// FEAT-pocket-buckit Step 6 — the review-page track "drop source" bridge.
//
// The read-page tracklist is injected as VANILLA DOM by albumDetail.client.ts, so
// its per-track "담기" buttons can't mount React inline. Instead each button
// dispatches a `pb:add-track` window event and THIS island (mounted once on the
// review page, client:only) opens the shared AddToBucketMenu for that track —
// exactly the album hero's AddToBucketMenu path, just for a track. Logged-out adds
// route through the menu's pb:resume → Cognito → home PocketResume handoff, so a
// public reader can file a track too. Mirrors the existing `album:detail` bridge.
//
// Event name is duplicated as a string literal in albumDetail.client.ts (a .ts
// script must not import this .tsx, or it would pull React into that bundle).
import { useEffect, useState } from 'react'
import { AddToBucketMenu } from '@components/member/pocket/AddToBucketMenu'

export const PB_ADD_TRACK_EVENT = 'pb:add-track'

interface AddTrackDetail { trackId: string, title?: string }

export default function ReviewTrackAdder() {
  // `seq` bumps per request so re-filing the SAME track remounts AddToBucketMenu
  // (autoOpen fires once per mount — without a fresh key a repeat click is inert).
  const [pending, setPending] = useState<{ trackId: string, title: string, seq: number } | null>(null)

  useEffect(() => {
    let seq = 0
    const onAdd = (e: Event) => {
      const d = (e as CustomEvent<AddTrackDetail>).detail
      if (!d || typeof d.trackId !== 'string' || !d.trackId)
        return
      seq += 1
      setPending({ trackId: d.trackId, title: typeof d.title === 'string' && d.title ? d.title : '트랙', seq })
    }
    window.addEventListener(PB_ADD_TRACK_EVENT, onAdd)
    return () => window.removeEventListener(PB_ADD_TRACK_EVENT, onAdd)
  }, [])

  if (!pending)
    return null

  return (
    <AddToBucketMenu
	key={pending.seq}
	item={{ itemType: 'track', trackId: pending.trackId, title: pending.title }}
	autoOpen
	render={() => null}
	onResolved={() => setPending(null)}
    />
  )
}
