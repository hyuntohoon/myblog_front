// FIX-auth-identity-lifecycle Step 2 — the ONE consumer of `lib/postLoginIntent`.
//
// Mounted in `layout.astro`, which is the whole point. Its predecessor
// (`PocketResume`) sat on the home page, from a time when the Cognito callback
// forced `location.replace('/')`. The callback returns to `consumeReturnTo()`
// now, so an intent parked anywhere but home had no reader: the visitor's 담기 on
// `/review/[slug]` either expired quietly or reappeared as an unexplained picker
// on a later home visit. Layout-mounted, the resume happens wherever the
// callback lands.
//
// It renders nothing of its own. `bucket-add` mounts the shared picker with
// `autoOpen` (its «title» 담기 header IS the confirmation); `rate-album` asks the
// app-wide album overlay to reopen with its rating editor and renders null.
//
// Single-drain has two halves. `drainPostLoginIntent()` removes the intent from
// storage as it reads it, and the result is cached at MODULE scope so a REMOUNT
// of this island — the picker is open, something re-renders the tree around it —
// picks the same intent back up instead of finding an empty slot and dropping a
// resume mid-add. (The predecessor's comment credited this to React StrictMode.
// It does not: StrictMode's second render pass is discarded, so the first
// result stands with or without the cache. A mutation removing the cache under a
// StrictMode test passes; under an unmount/remount it does not, which is why the
// test asserts the latter.)
//
// Unlike the predecessor's cache, a LOGGED-OUT attempt is not cached — it leaves
// the slot unattempted so a sign-in later in the same document can still resume.
// The old module latched `null` forever the first time it mounted logged out,
// which on a public page was every time.
import type { PostLoginIntent } from '@lib/postLoginIntent'
import type { AddTarget } from '@components/member/pocket/AddToBucketMenu'
import { useEffect, useState } from 'react'
import { AddToBucketMenu } from '@components/member/pocket/AddToBucketMenu'
import { isLoggedIn } from '@lib/auth'
import { subscribeAuthIdentity } from '@lib/authIdentity'
import { openAlbumLatched } from '@lib/entityEvents'
import { drainPostLoginIntent } from '@lib/postLoginIntent'

// undefined = not yet attempted; PostLoginIntent|null = the drained result.
let drained: PostLoginIntent | null | undefined

function resumeIntent(): PostLoginIntent | null {
  if (drained === undefined && isLoggedIn())
    drained = drainPostLoginIntent()
  return drained ?? null
}

/** The picker target for a `bucket-add` — the drain guarantees the matching id. */
function addTarget(intent: PostLoginIntent): AddTarget | null {
  if (intent.kind !== 'bucket-add')
    return null
  if (intent.itemType === 'track' && intent.trackId)
    return { itemType: 'track', trackId: intent.trackId, title: intent.title }
  if (intent.itemType === 'review' && intent.reviewTargetId)
    return { itemType: 'review', reviewTargetId: intent.reviewTargetId, title: intent.title }
  if (intent.itemType === 'album' && intent.albumId)
    return { itemType: 'album', albumId: intent.albumId, title: intent.title }
  return null
}

export default function PostLoginResume() {
  const [intent, setIntent] = useState<PostLoginIntent | null>(resumeIntent)

  // An account boundary cancels a resume in progress. Account A's parked add
  // must not finish under B, and the drain's own identity gate cannot help here
  // — by then the intent is already out of storage and on screen. Re-attempting
  // after the reset is what lets a sign-in resume an intent parked earlier in
  // this same document (the mount above ran while logged out and found nothing).
  useEffect(() => subscribeAuthIdentity(() => {
    drained = undefined
    setIntent(resumeIntent())
  }), [])

  const target = intent ? addTarget(intent) : null

  useEffect(() => {
    if (intent?.kind !== 'rate-album')
      return
    // Latched, not a plain dispatch: `AlbumOverlay` is a sibling island and its
    // listener may not exist yet when this effect runs. See openAlbumLatched.
    openAlbumLatched({
      albumId: intent.albumId,
      title: intent.title,
      artist: intent.artist ?? undefined,
      cover: intent.cover,
      year: intent.year,
      openRating: true,
    })
    // The overlay owns the surface from here; nothing is left to resume.
    setIntent(null)
  }, [intent])

  if (!target)
    return null

  return (
    <AddToBucketMenu
	item={target}
	autoOpen
	render={() => null}
	onResolved={() => setIntent(null)}
    />
  )
}
