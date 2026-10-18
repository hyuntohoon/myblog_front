import type { AlbumDetail } from '../src/lib/albumDetail'
import type { components } from '../src/lib/api.gen'
import { OWNER_HANDLE } from '../src/lib/member'

// Fixture payloads. The search and /api/me payloads are typed against the
// generated contract (api.gen.ts), so a schema change that would break the real
// response shape fails `astro check` here too, instead of leaving the journeys
// green against a shape the API no longer sends. The album detail is typed
// against the client's own `AlbumDetail` (src/lib/albumDetail.ts), which is
// what the overlay reads; it is hand-written, not generated.

type Unified = components['schemas']['Music_UnifiedSearchResult']

export const ALBUM_ID = '00000000-0000-4000-8000-0000000000a1'
export const ARTIST_ID = '00000000-0000-4000-8000-0000000000b1'

export const unifiedMiles = {
	artists: [
		{ id: ARTIST_ID, name: 'Miles Davis', cover_url: null, genres: ['jazz'] },
	],
	albums: [
		{
			id: ALBUM_ID,
			title: 'Kind of Blue',
			artist_id: ARTIST_ID,
			artist_name: 'Miles Davis',
			cover_url: null,
			release_date: '1959-08-17',
			spotify_id: null,
			best_new: false,
		},
	],
	tracks: [
		{
			id: '00000000-0000-4000-8000-0000000000c1',
			title: 'So What',
			artist_name: 'Miles Davis',
			album_id: ALBUM_ID,
			album_title: 'Kind of Blue',
			cover_url: null,
			feat_artist_names: [],
		},
	],
} satisfies Unified

export const unifiedEmpty = { artists: [], albums: [], tracks: [] } satisfies Unified

export const kindOfBlueDetail: AlbumDetail = {
	album: {
		id: ALBUM_ID,
		title: 'Kind of Blue',
		release_date: '1959-08-17',
		cover_url: null,
		album_type: 'album',
		label: 'Columbia',
	},
	artists: [
		{ id: ARTIST_ID, name: 'Miles Davis', photo_url: null, genres: ['jazz'], popularity: null },
	],
	tracks: [
		{ id: 't1', title: 'So What', track_no: 1, duration_sec: 562, spotify_id: null, feat_artist_names: [] },
		{ id: 't2', title: 'Freddie Freeloader', track_no: 2, duration_sec: 586, spotify_id: null, feat_artist_names: [] },
		{ id: 't3', title: 'Blue in Green', track_no: 3, duration_sec: 337, spotify_id: null, feat_artist_names: [] },
	],
}

type Me = components['schemas']['Backend_MeResponse']

const meBase = { id: '00000000-0000-4000-8000-0000000000d1', display_name: 'e2e', created_at: '2026-01-01T00:00:00Z' }
/** The handle `isOwnerUser()` compares against. */
export const meOwner = { ...meBase, handle: OWNER_HANDLE } satisfies Me
export const meMember = { ...meBase, handle: 'user-e2e00000' } satisfies Me
