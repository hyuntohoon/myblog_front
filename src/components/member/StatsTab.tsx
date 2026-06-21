// Member dashboard — 분석 버킷 tab entry (FEAT-liked-tracks-workbench Step 2-3).
// Replaces the earlier flat distribution panel (FEAT-genre-artist-distribution)
// with the 좋아요한 트랙 (Liked Tracks) workbench: a sortable/filterable track
// table (list + cards), a live analysis panel (genre/artist distribution with a
// 좋아요/재생 source toggle + 연대 + 좋아요 흐름 + the 미분류 분류하기/장르 채우기
// affordance), and per-row actions (작품 상세 · 평론 버킷에 담기 · 평론 쓰기).
// ProfileApp renders <StatsTab onOpen={openDetail} />; the heavy lifting lives in
// LikedBoard / LikedAnalysis.
import type { DetailTarget } from '@lib/member'
import { LikedBoard } from './LikedBoard'

export function StatsTab({ onOpen }: { onOpen?: (t: DetailTarget) => void }) {
	return <LikedBoard onOpen={onOpen} />
}
