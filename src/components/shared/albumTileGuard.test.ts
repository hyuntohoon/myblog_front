// Front UI/UX audit 2026-10-16 S1 + S2 — ratchet guard for album tiles and
// cover implementations. The audit found album tiles bypassing `AlbumCard`
// and ~10 copies of the cover image/placeholder branch. This test does not
// forbid what already exists; it pins a per-file baseline so the count can
// only go down. A file above its baseline (or a new file) fails; a file below
// it also fails, so whoever migrates a surface lowers the number in the same
// change and the baseline never goes slack.
//
// Counters, per non-test .tsx file under src/:
// - usage: JSX `<Cover` / `<AlbumArt` — the cover components a bespoke tile is
//   built from (`home/ui`, `member/ui`, or a local copy). A surface on
//   `AlbumCard` / `CoverImage` has none. The shared ones are now `CoverImage`
//   delegates, so this counts call sites, not copies: replacing a local copy
//   with the shared `Cover` can raise it (S2, NowPlaying and LikedBoard).
// - placeholder: the `cover-ph` class — hand-rolled placeholder markup. Its
//   only legitimate home is `shared/CoverImage.tsx`.
// - definition: a local `function *Cover` / `AlbumArt` / `CoverArt`. The
//   listed delegates are wrappers that render `CoverImage` and are exempt.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Counts { usage?: number, placeholder?: number, definition?: number }

/**
 * Measured on the S1/S2 ArtistHub branch (main b2e018e had ArtistHub usage 2, home/ui · AlbumCard · TrackCard placeholder 1 each).
 * S2 member copies (main 4bb823d): member/ui `Cover` became a re-export of home/ui's and `AlbumArt` a delegate; LfCover, NpCover
 * and LkCover were removed for the shared `Cover`, so LastfmNowPlaying / NowPlaying / LikedBoard lost a definition and the last two
 * gained a call site; PocketTray's list-mode `Cover` is a delegate.
 * S2 search (main fa1027d): search/atoms `GCover` became a delegate, dropping its placeholder and definition.
 * S2 reviews (main 8e37c88): ReviewsIndex `Cover` became a delegate; its 10 call sites stay counted, the definition is gone.
 */
const BASELINE: Record<string, Counts> = {
	'src/components/album/AlbumDetailView.tsx': { usage: 3 },
	'src/components/home/EditorialHome.tsx': { usage: 4 },
	'src/components/home/TodayPickHistory.tsx': { usage: 1 },
	'src/components/home/TodaySongBuckit.tsx': { usage: 1 },
	'src/components/member/BucketBoard.tsx': { usage: 2 },
	'src/components/member/LastfmNowPlaying.tsx': { usage: 1 },
	'src/components/member/LikedBoard.tsx': { usage: 2 },
	'src/components/member/MemberProfile.tsx': { usage: 1 },
	'src/components/member/NowPlaying.tsx': { usage: 2 },
	'src/components/member/ReviewsTab.tsx': { usage: 2 },
	'src/components/member/pocket/PocketTray.tsx': { usage: 3 },
	'src/components/reviews/ReviewsIndex.tsx': { usage: 10 },
}

/** Wrappers that delegate to CoverImage (file → function name). */
const DELEGATES: Record<string, string> = {
	'src/components/home/ui.tsx': 'Cover',
	'src/components/member/pocket/PocketTray.tsx': 'Cover',
	'src/components/member/ui.tsx': 'AlbumArt',
	'src/components/reviews/ReviewsIndex.tsx': 'Cover',
	'src/components/search/atoms.tsx': 'GCover',
	'src/components/shared/AlbumCard.tsx': 'CoverArt',
	'src/components/shared/TrackCard.tsx': 'CoverArt',
}

const COVER_IMAGE = 'src/components/shared/CoverImage.tsx'

const root = process.cwd()

function sourceFiles(): string[] {
	return (readdirSync(join(root, 'src'), { recursive: true }) as string[])
		.filter(f => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f))
		.map(f => relative(root, join(root, 'src', f)).split('\\').join('/'))
		.sort()
}

export function countCoverPatterns(file: string, text: string): Counts {
	const usage = text.match(/<(?:Cover|AlbumArt)[\s/>]/g)?.length ?? 0
	const placeholder = file === COVER_IMAGE ? 0 : text.match(/cover-ph/g)?.length ?? 0
	const definitions = [...text.matchAll(/function (\w*Cover|AlbumArt|CoverArt)\b/g)].map(m => m[1])
	const definition = definitions.filter(name => DELEGATES[file] !== name).length
	const out: Counts = {}
	if (usage)
		out.usage = usage
	if (placeholder)
		out.placeholder = placeholder
	if (definition)
		out.definition = definition
	return out
}

function measure(): Record<string, Counts> {
	const out: Record<string, Counts> = {}
	for (const file of sourceFiles()) {
		const counts = countCoverPatterns(file, readFileSync(join(root, file), 'utf8'))
		if (Object.keys(counts).length)
			out[file] = counts
	}
	return out
}

describe('album tile / cover ratchet (front audit S1 + S2)', () => {
	it('matches the baseline exactly — no new bypass, and migrations lower the baseline', () => {
		expect(measure()).toEqual(BASELINE)
	})

	it('delegates render CoverImage and carry no raw cover markup', () => {
		for (const file of Object.keys(DELEGATES)) {
			const text = readFileSync(join(root, file), 'utf8')
			expect(text, file).toMatch(/<CoverImage\b/)
			expect(text, file).not.toMatch(/cover-ph|<img\b/)
		}
	})

	it('artistHub discography stays on the canonical card', () => {
		const text = readFileSync(join(root, 'src/components/artist/ArtistHub.tsx'), 'utf8')
		expect(text).toMatch(/<CatalogAlbumCardAdapter\b/)
		expect(text).not.toMatch(/art-disco-cover|art-disco-item/)
	})

	it('collection shelves stay on the canonical card', () => {
		const text = readFileSync(join(root, 'src/components/collection/CollectionView.tsx'), 'utf8')
		expect(text).toMatch(/<CatalogAlbumCardAdapter\b/)
		expect(text).not.toMatch(/<AlbumArt\b/)
	})

	it('member profile 평가 rows stay on the canonical card', () => {
		const text = readFileSync(join(root, 'src/components/member/MemberProfile.tsx'), 'utf8')
		expect(text).toMatch(/<CatalogAlbumCardAdapter\b/)
		expect(text).not.toMatch(/<AlbumArt\b/)
	})

	it('overview 최근 평가 rows stay on the canonical card', () => {
		const text = readFileSync(join(root, 'src/components/member/OverviewDash.tsx'), 'utf8')
		const miniReview = text.slice(text.indexOf('function MiniReview('), text.indexOf('/** How many 최근 들은 앨범'))
		expect(miniReview).toMatch(/<CatalogAlbumCardAdapter\b/)
		expect(text).not.toMatch(/<AlbumArt\b/)
	})

	it('pocket card viewer album tiles stay on the canonical card', () => {
		const text = readFileSync(join(root, 'src/components/member/pocket/PocketTray.tsx'), 'utf8')
		const adapter = text.slice(text.indexOf('function PocketAlbumCardAdapter('), text.indexOf('// FEAT-pocket-buckit-viewers Track B — `url` + `square`'))
		expect(adapter).toMatch(/<AlbumCard\b/)
		const cardViewer = text.slice(text.indexOf('<div className="pb-cardgrid">'), text.indexOf('{bucket.albums.slice(0, 8)'))
		expect(cardViewer).toMatch(/<PocketAlbumCardAdapter\b/)
		expect(cardViewer).not.toMatch(/<Cover\b/)
	})

	it('member/ui keeps no cover copy of its own', () => {
		const text = readFileSync(join(root, 'src/components/member/ui.tsx'), 'utf8')
		expect(text).toMatch(/export \{ Cover \} from '\.\.\/home\/ui'/)
		expect(text).not.toMatch(/function Cover\b/)
	})

	// Not a ratchet to lower: a canon card is a published review, which RFC
	// ARCH-album-card-contract §12 keeps on its document renderer. S1 is met here
	// by S2 (the cover goes through CoverImage), as for ArtistHub's review cards.
	it('canon cards stay document cards with the shared cover', () => {
		const text = readFileSync(join(root, 'src/components/canon/CanonPage.tsx'), 'utf8')
		expect(text).toMatch(/<CoverImage\b/)
		expect(text).not.toMatch(/<AlbumCard\b|AlbumCardAdapter\b/)
	})

	it('counts a bespoke tile built from a legacy cover', () => {
		const tile = `import { Cover } from '../home/ui'\nfunction XCover() { return <span className="cover-ph" /> }\nconst t = <div className="art-disco-tile"><Cover label="a" /></div>`
		expect(countCoverPatterns('src/components/artist/ArtistHub.tsx', tile)).toEqual({ usage: 1, placeholder: 1, definition: 1 })
	})
})
