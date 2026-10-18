// Session-aware capabilities (front UI/UX audit 2026-10-16, S5): a React view of
// "is anyone logged in", for islands that must change what they OFFER — not just
// what a click does — when the visitor is anonymous.
//
// `subscribeAuthIdentity` is the account-boundary signal (same-tab sync calls and
// cross-tab `storage` events both reach it), so a login or logout in another tab
// re-renders here too. The server snapshot is `false`: SSR cannot read storage, and
// an anonymous first paint is the safe one — a hydrated island then re-renders with
// the real answer instead of advertising a member capability it may not have.
import { useSyncExternalStore } from 'react'
import { isLoggedIn } from '@lib/auth'
import { subscribeAuthIdentity } from '@lib/authIdentity'

function subscribe(onChange: () => void): () => void {
	return subscribeAuthIdentity(() => onChange())
}

export function useLoggedIn(): boolean {
	return useSyncExternalStore(subscribe, isLoggedIn, () => false)
}
