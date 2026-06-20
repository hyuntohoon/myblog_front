// Touch fallback for the crate board — a reusable bottom sheet that lists every
// bucket (flat, nested ones indented) so a tap picks a target. The board's
// HTML5 drag-and-drop never fires on touch devices (no onDragStart from a
// touch), so on coarse pointers each AlbumChip / BucketCard exposes a small ⋯
// action that opens an action sheet → this picker → the SAME mutation ops the
// drop handlers call (ops.copyAlbum / ops.insertAlbum / ops.moveBucketTo /
// ops.moveBucketInto). Desktop drag is untouched.
//
// Portaled to <body> like TrashDock (the tab-content wrapper keeps a filled
// identity transform, which would otherwise be the containing block for a
// position:fixed sheet). Dismissable on backdrop tap / ESC.
import type { BoardBucket } from '@lib/buckets'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// Filter that hides a bucket (and its subtree) from the picker — e.g. a bucket
// can't be moved into itself or its own descendants.
export interface PickerEntry { id: string, name: string, depth: number }

// Flatten the tree to a depth-tagged list, skipping any node for which `skip`
// returns true (its whole subtree is omitted too).
function flatten(buckets: BoardBucket[], depth: number, skip: (b: BoardBucket) => boolean, out: PickerEntry[]) {
  for (const b of buckets) {
    if (skip(b))
      continue
    out.push({ id: b.id, name: b.name, depth })
    flatten(b.children, depth + 1, skip, out)
  }
}

export function BucketPickerSheet({ title, tree, skip, allowRoot, onPick, onClose }: {
  title: string
  tree: BoardBucket[]
  // Hidden bucket subtrees (default: nothing hidden).
  skip?: (b: BoardBucket) => boolean
  // When set, prepend a "최상위로" choice that calls onPick(null) — used by the
  // bucket-move sheet so a nested bucket can be un-nested to the top level.
  allowRoot?: boolean
  onPick: (bucketId: string | null) => void
  onClose: () => void
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const entries: PickerEntry[] = []
  flatten(tree, 0, skip ?? (() => false), entries)

  return createPortal(
    <div className="bps-scrim" onClick={onClose} role="presentation">
      <div className="bps-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="bps-head">
          <span className="lf-serif" style={{ fontSize: 17, fontWeight: 500 }}>{title}</span>
          <button type="button" className="lf-iconbtn" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="bps-list">
          {allowRoot && (
            <button type="button" className="bps-item" onClick={() => onPick(null)}>
              <span className="lf-serif">최상위로</span>
            </button>
          )}
          {entries.length === 0 && !allowRoot && (
            <div className="lf-mono bps-empty">버킷 없음</div>
          )}
          {entries.map(e => (
            <button
	key={e.id}
	type="button"
	className="bps-item"
	style={{ paddingLeft: 16 + e.depth * 18 }}
	onClick={() => onPick(e.id)}
            >
              {e.depth > 0 && <span className="lf-mono bps-indent">└</span>}
              <span className="lf-serif" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
