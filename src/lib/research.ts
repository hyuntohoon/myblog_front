// FEAT-album-research-notes Step 5 — front client + shared store for the
// per-album AI research note. Two authed routes (Step 4 contract):
//   GET  /api/research/albums/{id}  → latest note (404 when none yet)
//   POST /api/research/albums/{id}  → first-run / restart / refine trigger
// Both go through apiFetch (Bearer + 401 refresh); the note belongs to the
// ALBUM, not the surface, so the BucketBoard cover panel and the /write rail
// share one cache keyed by album_id. A tiny external store (useSyncExternalStore)
// lets a cover badge and an opened panel for the same album stay in lock-step,
// and dedupes the GET when several surfaces mount for one album at once.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type ResearchNote = components['schemas']['Backend_AlbumResearchResponse']
export type ResearchStatus = 'queued' | 'running' | 'done' | 'failed'
export interface ResearchTrigger { mode?: 'restart' | 'refine', instruction?: string }

export const RESEARCH_STATUS_LABEL: Record<ResearchStatus, string> = {
	queued: '대기 중',
	running: '조사 중',
	done: '조사 완료',
	failed: '실패',
}

// Dot color from the crate board's existing status vocabulary (green/amber/red)
// so research reads as part of the same system. Shared by the note panel and
// the per-cover badge.
export function researchStatusColor(s: ResearchStatus | null): string {
	if (s === 'done')
		return 'oklch(0.58 0.10 155)'
	if (s === 'running')
		return 'var(--color-warn)'
	if (s === 'failed')
		return 'var(--color-accent)'
	return 'var(--color-faded)' // queued / unknown
}

// ── raw API ───────────────────────────────────────────────────────────────--
/** GET the latest note for an album. 404 (never researched) maps to null. */
export async function fetchAlbumResearch(albumId: string): Promise<ResearchNote | null> {
	const res = await apiFetch(`${BASE}/api/research/albums/${encodeURIComponent(albumId)}`, { method: 'GET' })
	if (!res)
		throw new Error('network error (no response)')
	if (res.status === 404)
		return null
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`)
	return res.json() as Promise<ResearchNote>
}

/** POST a trigger — no body = first run; {mode:'restart'} redo; {mode:'refine',instruction} augment. */
export async function postAlbumResearch(albumId: string, body: ResearchTrigger = {}): Promise<ResearchNote> {
	const res = await apiFetch(`${BASE}/api/research/albums/${encodeURIComponent(albumId)}`, {
		method: 'POST',
		body: JSON.stringify(body),
	})
	if (!res)
		throw new Error('network error (no response)')
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`)
	return res.json() as Promise<ResearchNote>
}

// ── external store (album_id → entry) ───────────────────────────────────────
interface Entry {
	note: ResearchNote | null
	loading: boolean
	error: boolean
	/** A GET has resolved at least once (note may legitimately be null). */
	loaded: boolean
}
const EMPTY: Entry = { note: null, loading: false, error: false, loaded: false }
const cache = new Map<string, Entry>()
const subs = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<void>>()

function getEntry(albumId: string): Entry {
	return cache.get(albumId) ?? EMPTY
}
function setEntry(albumId: string, patch: Partial<Entry>) {
	cache.set(albumId, { ...getEntry(albumId), ...patch })
	const s = subs.get(albumId)
	if (s) {
		for (const cb of s)
			cb()
	}
}
function subscribe(albumId: string, cb: () => void): () => void {
	let s = subs.get(albumId)
	if (!s) {
		s = new Set()
		subs.set(albumId, s)
	}
	s.add(cb)
	return () => void s.delete(cb)
}

/** Load (or refresh) the note. Dedupes concurrent loads; force=true bypasses the cache (poll). */
function load(albumId: string, force = false): Promise<void> {
	const cur = getEntry(albumId)
	if (!force && (cur.loaded || cur.loading))
		return inflight.get(albumId) ?? Promise.resolve()
	setEntry(albumId, { loading: true, error: false })
	const p = fetchAlbumResearch(albumId)
		.then(note => setEntry(albumId, { note, loading: false, error: false, loaded: true }))
		.catch(() => setEntry(albumId, { loading: false, error: true, loaded: true }))
		.finally(() => void inflight.delete(albumId))
	inflight.set(albumId, p)
	return p
}

/** POST a trigger then fold the returned row straight into the store (no extra GET). */
async function mutate(albumId: string, body: ResearchTrigger): Promise<void> {
	setEntry(albumId, { loading: true, error: false })
	try {
		const note = await postAlbumResearch(albumId, body)
		setEntry(albumId, { note, loading: false, error: false, loaded: true })
	}
	catch {
		// Keep any prior note in place (refine must never blank the panel on a
		// failed POST — see RFC); just surface the error + drop the spinner.
		setEntry(albumId, { loading: false, error: true })
	}
}

// ── hook ────────────────────────────────────────────────────────────────---
export interface UseResearch {
	note: ResearchNote | null
	status: ResearchStatus | null
	loading: boolean
	error: boolean
	loaded: boolean
	/** First-run manual trigger (no mode). */
	trigger: () => Promise<void>
	/** Incremental augment — keeps the existing note, sends the instruction. */
	refine: (instruction: string) => Promise<void>
	/** Full redo — clears the note server-side, re-queues. */
	restart: () => Promise<void>
	reload: () => Promise<void>
}

function noop() {}

/**
 * Subscribe a component to an album's research note. `auto` triggers a lazy GET
 * on mount (used by research-active surfaces); leave it false to load only on an
 * explicit action. Polls every 4s while the row is queued/running, then stops.
 */
export function useResearch(albumId: string | null, opts: { auto?: boolean } = {}): UseResearch {
	const { auto = false } = opts
	const sub = useCallback((cb: () => void) => (albumId ? subscribe(albumId, cb) : noop), [albumId])
	const snapshot = useCallback(() => (albumId ? getEntry(albumId) : EMPTY), [albumId])
	const entry = useSyncExternalStore(sub, snapshot, snapshot)
	const status = (entry.note?.status ?? null) as ResearchStatus | null

	useEffect(() => {
		if (auto && albumId) {
			const e = getEntry(albumId)
			if (!e.loaded && !e.loading)
				void load(albumId)
		}
	}, [auto, albumId])

	// Poll while the poller is still working the row. Safety-capped so a row
	// wedged in 'running' (laptop slept mid-run) can't poll forever.
	useEffect(() => {
		if (!albumId || (status !== 'queued' && status !== 'running'))
			return
		let n = 0
		const iv = setInterval(() => {
			n += 1
			if (n > 150) {
				clearInterval(iv)
				return
			}
			void load(albumId, true)
		}, 4000)
		return () => clearInterval(iv)
	}, [albumId, status])

	const trigger = useCallback(() => (albumId ? mutate(albumId, {}) : Promise.resolve()), [albumId])
	const refine = useCallback((instruction: string) => (albumId ? mutate(albumId, { mode: 'refine', instruction }) : Promise.resolve()), [albumId])
	const restart = useCallback(() => (albumId ? mutate(albumId, { mode: 'restart' }) : Promise.resolve()), [albumId])
	const reload = useCallback(() => (albumId ? load(albumId, true) : Promise.resolve()), [albumId])

	return { note: entry.note, status, loading: entry.loading, error: entry.error, loaded: entry.loaded, trigger, refine, restart, reload }
}
