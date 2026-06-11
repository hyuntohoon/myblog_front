// Per-album draft persistence for /write.
//
// Before: one localStorage slot (`lowfreq-draft`) held the whole draft, so
// switching the subject album (⌘K pick, or arriving via /profile ?album=) kept
// the previous album's body/title — the old text "followed" you onto the new
// album. Now each subject gets its OWN slot, keyed by album id (artist id for
// artist subjects, a shared `__none__` slot for no-subject/essay drafts), plus
// a pointer to the last-active slot so a plain /write visit restores what you
// were last working on. Switching albums flushes the current slot and loads the
// target's — each album's WIP is kept separate.
//
// All reads/writes are try/catch-guarded so they're safe during Astro's SSR of
// the island (where `localStorage` is undefined) — the same posture the old
// inline loadDraft() relied on.
import type { DraftPersist } from '../../components/writer/types'

const PREFIX = 'lowfreq-draft'
const NONE = '__none__'
const ACTIVE_KEY = `${PREFIX}:__active__`

function slotKey(albumId: string | null): string {
	return `${PREFIX}:${albumId ?? NONE}`
}

/**
 * One-time migration of the legacy single `lowfreq-draft` slot into a keyed
 * slot (under its own subject, or `__none__`). No-op once migrated / absent.
 */
export function migrateLegacyDraft(): void {
	try {
		const legacy = localStorage.getItem(PREFIX)
		if (!legacy)
			return
		let key: string | null = null
		try {
			key = (JSON.parse(legacy) as Partial<DraftPersist>)?.subject?.id ?? null
		}
		catch { /* malformed → land it in the none slot */ }
		// Don't clobber a keyed slot that already exists for this subject.
		if (!localStorage.getItem(slotKey(key))) {
			localStorage.setItem(slotKey(key), legacy)
			localStorage.setItem(ACTIVE_KEY, key ?? NONE)
		}
		localStorage.removeItem(PREFIX)
	}
	catch { /* SSR / quota / parse — nothing to migrate */ }
}

/** The album id of the last-active slot (null = the no-subject slot). */
export function activeDraftId(): string | null {
	try {
		const v = localStorage.getItem(ACTIVE_KEY)
		return !v || v === NONE ? null : v
	}
	catch {
		return null
	}
}

/** Load a subject's draft slot (empty object on miss / SSR / parse error). */
export function loadDraftSlot(albumId: string | null): Partial<DraftPersist> {
	try {
		const raw = localStorage.getItem(slotKey(albumId))
		return raw ? JSON.parse(raw) as Partial<DraftPersist> : {}
	}
	catch {
		return {}
	}
}

/** Persist a subject's draft slot and mark it active. */
export function saveDraftSlot(albumId: string | null, draft: DraftPersist): void {
	try {
		localStorage.setItem(slotKey(albumId), JSON.stringify(draft))
		localStorage.setItem(ACTIVE_KEY, albumId ?? NONE)
	}
	catch { /* quota / SSR */ }
}

/** Drop a subject's draft slot (on reset / after publish). */
export function removeDraftSlot(albumId: string | null): void {
	try {
		localStorage.removeItem(slotKey(albumId))
	}
	catch { /* SSR */ }
}
