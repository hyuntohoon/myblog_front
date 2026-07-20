// RFC-ui-surface-unification Step 3, owner decision 11.
// Missing post-build /artist/{id} pages reuse ArtistHub with live data until
// the next push-to-main build promotes them to real static pages.
import { useState } from 'react'
import '../../styles/notfound.css'
import ArtistHub from '../artist/ArtistHub'

export default function NotFoundShell() {
	const [path] = useState(() => window.location.pathname)
	const artistMatch = path.match(/^\/artist\/([^/]+)\/?$/)

	if (artistMatch) {
		const artistId = decodeURIComponent(artistMatch[1])
		return <ArtistHub artistId={artistId} name="" reviews={[]} reviewedAlbumIds={[]} />
	}

	return (
		<div className="nf-root">
			<div className="nf-kicker mono">404 · NOT FOUND</div>
			<h1 className="nf-title serif">이 페이지는 카탈로그에 없습니다.</h1>
			<p className="nf-sub sans">주소가 바뀌었거나, 아직 만들어지지 않은 페이지예요.</p>
			<p className="nf-path mono">{path}</p>
			<nav className="nf-actions">
				<a href="/">홈으로</a>
				<a href="/search/">앨범·아티스트 검색</a>
			</nav>
		</div>
	)
}
