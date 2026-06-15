// FEAT-artist-page link-in — resolve catalog artist names for build-time review
// bylines so they can link to /artist/{id}. The post's `artistIds` (frontmatter)
// are the canonical subject artists, but the frontmatter has no name-per-id map
// (`musicReview.artists` are the ALBUM's artist names, a DIFFERENT source — not
// index-aligned with artistIds). So we resolve names authoritatively from the
// music catalog via GET /api/music/artists/ids ({id,name}), memoized once per build.

export interface ArtistLink {
	id: string
	name: string
}

let _mapPromise: Promise<Map<string, string>> | null = null

/**
 * Build-time fetch of the catalog artist {id → name} map, memoized for the whole
 *  build. Returns an empty map on any failure (offline/local build) so callers
 *  fall back to the plain byline instead of breaking the build.
 */
export function getArtistNameMap(): Promise<Map<string, string>> {
	if (_mapPromise)
		return _mapPromise
	_mapPromise = (async () => {
		try {
			const base = import.meta.env.PUBLIC_API_URL
			const res = await fetch(`${base}/api/music/artists/ids`)
			if (!res.ok)
				return new Map<string, string>()
			const list = (await res.json()) as ArtistLink[]
			return new Map(list.map(a => [a.id, a.name]))
		}
		catch {
			return new Map<string, string>()
		}
	})()
	return _mapPromise
}

/**
 * Per-artist links from a post's artistIds, using authoritative catalog names.
 *  Returns null when the list is empty OR any id is unresolved (a non-catalog
 *  artist, or an offline build) — the caller then renders the plain byline, so we
 *  never emit a wrong or half link.
 */
export function resolveArtistLinks(
	artistIds: string[] | undefined,
	nameMap: Map<string, string>,
): ArtistLink[] | null {
	if (!artistIds || artistIds.length === 0)
		return null
	const links: ArtistLink[] = []
	for (const id of artistIds) {
		const name = nameMap.get(id)
		if (!name)
			return null
		links.push({ id, name })
	}
	return links
}
