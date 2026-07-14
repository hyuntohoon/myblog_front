// FEAT-public-bucket-multiuser Scope A A4 — read-only public collection viewer.
//
// A slim, no-DnD/no-edit album grid mounted on /collection. Fetches the
// unauthenticated GET /api/buckets/public on the client (so it reflects the
// owner's current public toggles, A3) and renders each public bucket as a
// section of album covers. Graceful loading / error / empty states.
import type { PublicCollection } from '@lib/buckets'
import { useEffect, useState } from 'react'
import { listPublicBuckets } from '@lib/buckets'
import { AlbumArt, SectionTitle } from '@components/member/ui'

function Notice({ title, sub }: { title: string, sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '64px 16px' }}>
      <p className="serif" style={{ fontSize: 20, color: 'var(--color-text)', margin: 0 }}>{title}</p>
      {sub && <p className="sans" style={{ fontSize: 13.5, color: 'var(--color-subtle)', marginTop: 8 }}>{sub}</p>}
    </div>
  )
}

// Skeleton mirroring the real bucket-section grid so the load doesn't flash a
// bare "불러오는 중…" line then pop (audit M9). Reuses the .lf-skeleton shimmer.
function CollectionSkeleton() {
  return (
    <div className="lf-skel-stack" aria-busy="true" aria-label="불러오는 중" style={{ gap: 44 }}>
      {[0, 1].map(s => (
        <section key={s}>
          <div className="lf-skeleton" style={{ height: 22, width: 180, marginBottom: 18 }} />
          <div style={{ display: 'grid', gap: '16px 12px', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="lf-skeleton" style={{ aspectRatio: '1 / 1' }} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default function CollectionView() {
  const [data, setData] = useState<PublicCollection[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    listPublicBuckets()
      .then(d => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [])

  if (error)
    return <Notice title="컬렉션을 불러오지 못했습니다" sub="잠시 후 다시 시도해 주세요." />
  if (data == null)
    return <CollectionSkeleton />

  const collections = data.filter(c => c.albums.length > 0)
  if (collections.length === 0)
    return <Notice title="아직 공개된 컬렉션이 없습니다" sub="회원이 공개로 설정한 My Buckit이 여기에 모입니다." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 44 }}>
      {collections.map(c => (
        <section key={c.id}>
          <SectionTitle
	title={c.name}
	right={(
	// Attribution: any member can publish a bucket (multi-user P2) — every
	// shelf says whose it is. Plain text (no /members link) until member
	// pages are runtime-reachable; owner==null only during backend rollout.
	<span className="mono" style={{ fontSize: 12, color: 'var(--color-faded)' }}>
		{c.owner ? `@${c.owner.handle} · ${c.albums.length}장` : `${c.albums.length}장`}
	</span>
	)}
          />
          <div style={{ display: 'grid', gap: '16px 12px', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {c.albums.map(a => (
              <figure key={a.albumId} style={{ margin: 0, minWidth: 0 }}>
                <AlbumArt url={a.cover} label={a.title} />
                <figcaption style={{ marginTop: 7 }}>
                  <div
	className="serif"
	style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {a.title}
                  </div>
                  <div className="meta" style={{ marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.year ? `${a.artist} · ${a.year}` : a.artist}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
