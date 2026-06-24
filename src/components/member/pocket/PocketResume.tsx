// FEAT-pocket-buckit Step 5 — the post-login resume island. Mounted on home, where
// the Cognito callback always lands (callback.client.ts forces location.replace('/')).
// If a fresh sign-in handoff intent exists AND the user is now authenticated, it
// reopens the bucket picker (its «title» 담기 header IS the confirmation) so the add
// the visitor started while logged out completes after sign-in. Renders nothing in
// the common case (no pending intent / not logged in).
//
// Single-drain + idempotent: drainPocketIntent() removes the blob on read; the
// result is cached at MODULE scope so a StrictMode double-mount (or any remount)
// reuses it instead of the throwaway first mount eating the intent. TTL-bounded in
// intent.ts (a stale intent is dropped).
import type { PocketIntent } from '@lib/pocketBuckit/intent'
import { useState } from 'react'
import { AddToBucketMenu } from '@components/member/pocket/AddToBucketMenu'
import { isLoggedIn } from '@lib/auth'
import { drainPocketIntent } from '@lib/pocketBuckit/intent'

// Module singleton: undefined = not yet drained; PocketIntent|null = the drained
// result, reused across remounts so the drain side-effect happens exactly once.
let drained: PocketIntent | null | undefined

function resumeIntent(): PocketIntent | null {
  if (drained === undefined)
    drained = isLoggedIn() ? drainPocketIntent() : null
  return drained
}

export default function PocketResume() {
  const [intent] = useState(resumeIntent)

  if (!intent)
    return null

  // No trigger of its own (render → null); autoOpen drives the picker, and the
  // sheet + toast (body portals) are the whole surface.
  return (
    <AddToBucketMenu
	item={{ albumId: intent.albumId, title: intent.title }}
	autoOpen
	render={() => null}
    />
  )
}
