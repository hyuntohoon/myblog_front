// Member dashboard — 분석 버킷 tab entry (FEAT-liked-tracks-workbench Step 2-3).
// Replaces the earlier flat distribution panel (FEAT-genre-artist-distribution)
// with the 좋아요한 트랙 (Liked Tracks) workbench: a sortable/filterable track
// table (list + cards), a live analysis panel (genre/artist distribution with a
// 좋아요/재생 source toggle + 연대 + 좋아요 흐름 + the 미분류 분류하기/장르 채우기
// affordance), and per-row actions (작품 상세 · 평론 버킷에 담기 · 평론 쓰기).
// SelfDashboard renders <StatsTab onOpen={openDetail} />; the heavy lifting lives in
// LikedBoard / LikedAnalysis.
//
// SEC-member-listening-data-boundary Step 1 — who sees what in this tab.
// `LikedBoard` is a table over `GET /api/library/saved-tracks`, an owner-global
// table with no user column, so for a non-owner every row was the OWNER's 좋아요.
// The tab is NOT hidden for them, because the 임포트 분석 inside it reads
// `/api/library/stream-history/*`, which is member-scoped and genuinely theirs
// (the RFC's non-goals say so explicitly). So a member gets the analysis panel
// with only the 임포트 lens, and the liked-tracks workbench that wraps it is the
// part that goes away.
import type { DetailTarget } from '@lib/member'
import { LikedAnalysis } from './LikedAnalysis'
import { LikedBoard } from './LikedBoard'

// Stable identity — LikedAnalysis's 좋아요-derived widgets take `rows`, and for a
// member there are none. A module constant keeps it out of the render loop's deps.
const NO_LIKED_ROWS: never[] = []

export function StatsTab({ isOwner, onOpen, onOpenLyrics }: { isOwner: boolean, onOpen?: (t: DetailTarget) => void, onOpenLyrics?: (spotifyTrackId: string) => void }) {
	if (!isOwner)
		return <LikedAnalysis rows={NO_LIKED_ROWS} loadedCount={0} likedSourceAvailable={false} />
	return <LikedBoard onOpen={onOpen} onOpenLyrics={onOpenLyrics} />
}
