// Member dashboard — 평론 tab. Reviews are REAL (built server-side from the
// blog content collection, passed in as props). Type filter + sort; uniform
// card height across types. Delete is client-only in Step 1 (no post-delete
// API wired here yet) — a refresh restores the list.
import type { DetailTarget, MemberReview, MemberReviewType } from '@lib/member'
import { useState } from 'react'
import { REVIEW_TYPES } from '@lib/member'
import { Cover, SectionTitle, Seg, Stars } from './ui'

type TypeFilter = '전체' | MemberReviewType
type SortKey = 'recent' | 'score'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function ReviewCard({ r, onOpen, onDelete }: { r: MemberReview, onOpen: (t: DetailTarget) => void, onDelete: (slug: string) => void }) {
  const isColumn = r.type === '칼럼'
  const clickable = !isColumn
  const open = () => clickable && onOpen({ album: r.album, artist: r.artist, genre: r.genre, year: r.year, rating: r.rating, track: r.type === '트랙 리뷰' ? r.album : undefined })
  return (
    <article className="lf-panel" style={{ padding: 16, display: 'flex', gap: 16, background: 'var(--color-bg)' }}>
      <div onClick={open} style={{ cursor: clickable ? 'pointer' : 'default', flex: '0 0 auto' }}><Cover label={r.album} size={92} radius={3} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="lf-meta" style={{ marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: isColumn ? 'var(--color-accent)' : 'var(--color-faded)' }}>{r.type}</span>
          <span>
·
{fmtDate(r.date)}
          </span>
        </div>
        <div className="lf-mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3, color: isColumn ? 'var(--color-faded)' : 'var(--color-text)' }}>{isColumn ? '에세이' : r.artist || '아티스트 미상'}</div>
        <h3
	onClick={open}
	className="lf-serif lf-italic"
	style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.2, margin: 0, cursor: clickable ? 'pointer' : 'default', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '2.4em' }}
        >
          {r.album}
          {r.year != null && (
<span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', fontStyle: 'normal', whiteSpace: 'nowrap' }}>
{' '}
(
{r.year}
)
</span>
)}
        </h3>
        <p className="lf-serif" style={{ margin: '8px 0 12px', fontSize: 14, color: 'var(--color-subtle)', lineHeight: 1.6, textWrap: 'pretty', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '3.2em' }}>{r.excerpt}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
          {r.rating != null ? <Stars score={r.rating} size={16} /> : <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', letterSpacing: '.08em', textTransform: 'uppercase' }}>칼럼</span>}
          <a href={`/blog/${r.slug}`} className="lf-chip" style={{ marginLeft: 'auto', textDecoration: 'none' }}>보기</a>
          <button type="button" className="lf-chip" onClick={() => onDelete(r.slug)} style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 35%, var(--color-border))' }}>삭제</button>
        </div>
      </div>
    </article>
  )
}

export function ReviewsTab({ reviews, onOpen }: { reviews: MemberReview[], onOpen: (t: DetailTarget) => void }) {
  const [list, setList] = useState(reviews)
  const [type, setType] = useState<TypeFilter>('전체')
  const [sort, setSort] = useState<SortKey>('recent')
  const [pending, setPending] = useState<string | null>(null)

  let view = type === '전체' ? list.slice() : list.filter(r => r.type === type)
  view = view.sort((a, b) => (sort === 'score' ? (b.rating ?? -1) - (a.rating ?? -1) : new Date(b.date).getTime() - new Date(a.date).getTime()))

  const confirmDel = () => {
    setList(l => l.filter(r => r.slug !== pending))
    setPending(null)
  }

  return (
    <div>
      <SectionTitle
	kicker={`${view.length}편`}
	title="내가 쓴 평론"
	right={<Seg value={sort} onChange={v => setSort(v as SortKey)} options={[{ v: 'recent', label: '최신' }, { v: 'score', label: '평점' }]} />}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {REVIEW_TYPES.map(g => <span key={g} className="lf-chip" data-on={type === g} onClick={() => setType(g as TypeFilter)}>{g}</span>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {view.map(r => <ReviewCard key={r.slug} r={r} onOpen={onOpen} onDelete={setPending} />)}
        {view.length === 0 && <div className="lf-panel" style={{ padding: 40, textAlign: 'center' }}><span className="lf-meta">해당 유형의 평론이 없습니다</span></div>}
      </div>
      {pending != null && (
        <div className="lf-scrim" style={{ justifyContent: 'center', alignItems: 'center' }} onClick={() => setPending(null)}>
          <div className="lf-panel" onClick={e => e.stopPropagation()} style={{ background: 'var(--color-bg)', padding: 24, maxWidth: 360, width: '90%', animation: 'lf-rise .2s both' }}>
            <div className="lf-kicker" style={{ color: 'var(--color-accent)', marginBottom: 8 }}>평론 삭제</div>
            <p className="lf-serif" style={{ fontSize: 16, margin: '0 0 8px', lineHeight: 1.5 }}>이 평론을 목록에서 숨길까요?</p>
            <p className="lf-meta" style={{ margin: '0 0 18px', textTransform: 'none', letterSpacing: 0 }}>* Step 1에서는 화면에서만 제거되며 새로고침하면 복원됩니다 (실제 삭제 API는 후속 단계).</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="lf-btn" onClick={() => setPending(null)}>취소</button>
              <button type="button" className="lf-btn lf-btn-accent" onClick={confirmDel}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
