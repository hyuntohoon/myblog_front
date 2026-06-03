// FEAT-review-bucket-board Step 4 — a single album card in a bucket column.
// Reuses the reviews cover chrome. Queue albums are *pre-review*, so the
// BucketItemResponse carries no rating → no stars are rendered here (the
// meaningful signal is `already_reviewed`). Stars-only/canonical-rating stays
// the rule for anywhere a real review rating is shown (Step 5 drawer).
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BucketItem } from './api'

function year(release?: string | null): string | null {
  return release ? release.slice(0, 4) : null
}

function Cover({ item }: { item: BucketItem }) {
  const { title, cover_url } = item.album
  return (
    <div className="qb-card-cover">
      {cover_url ?
        <img src={cover_url} alt={title} loading="lazy" /> :
        <span className="qb-card-cover-ph" aria-hidden="true">{(title || '?').slice(0, 2).toUpperCase()}</span>}
    </div>
  )
}

interface BodyProps {
  item: BucketItem
  onOpen?: () => void
  onRemove?: () => void
  dragging?: boolean
}

/** Presentational card (also used inside the DragOverlay). */
export function AlbumCardBody({ item, onOpen, onRemove, dragging }: BodyProps) {
  const { album } = item
  const artist = album.artist_names?.length ? album.artist_names.join(', ') : null
  const yr = year(album.release_date)
  const published = item.status === 'published'

  return (
    <article className={`qb-card${dragging ? ' is-dragging' : ''}${published ? ' is-published' : ''}`}>
      <button
	type="button"
	className="qb-card-main"
	onClick={onOpen}
	title="앨범 상세 보기"
      >
        <Cover item={item} />
        <div className="qb-card-text">
          <div className="qb-card-title"><em>{album.title}</em></div>
          {artist && <div className="qb-card-artist">{artist}</div>}
          <div className="qb-card-meta">
            {yr && <span className="qb-card-year">{yr}</span>}
            {item.rec_reason && <span className="qb-chip qb-chip-rec">{item.rec_reason}</span>}
            {item.already_reviewed && <span className="qb-chip qb-chip-reviewed" title="이미 리뷰한 앨범">리뷰됨</span>}
            {published && <span className="qb-chip qb-chip-done">발행</span>}
          </div>
          {item.note && <p className="qb-card-note">{item.note}</p>}
        </div>
      </button>
      {onRemove && (
        <button
	type="button"
	className="qb-card-remove"
	onClick={onRemove}
	title="버킷에서 제거"
	aria-label="버킷에서 제거"
        >
          ✕
        </button>
      )}
    </article>
  )
}

interface SortableProps {
  item: BucketItem
  onOpen: () => void
  onRemove: () => void
}

/** Sortable wrapper — the whole card is the drag handle (pointer-activated). */
export default function AlbumCard({ item, onOpen, onRemove }: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="qb-card-sortable" {...attributes} {...listeners}>
      <AlbumCardBody item={item} onOpen={onOpen} onRemove={onRemove} />
    </div>
  )
}
