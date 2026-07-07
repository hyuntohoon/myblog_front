// App-wide read-only album overlay (ARCH-entity-interaction-unify Step 1).
//
// Mounted once in layout.astro (sibling to PocketBuckit), UN-gated so it works
// on public pages too — unlike PocketBuckit, which returns null when logged out.
// Opens on the `ent:open-album` window event (lib/entityEvents): any surface
// (public review, home tiles, search) dispatches it via openAlbum(). Member
// surfaces keep their own writable AlbumDetail modal (ProfileApp onOpen) — this
// overlay is read-only: no lyrics affordance (onOpenLyrics omitted = privacy),
// no memo/edit. Closes on ESC/scrim/✕ and on SPA navigation.
import type { OpenAlbumDetail } from '@lib/entityEvents'
import { useEffect, useRef, useState } from 'react'
import { ENT_OPEN_ALBUM } from '@lib/entityEvents'
import { useDismissable } from '@lib/useDismissable'
import { useScrollLock } from '@lib/useScrollLock'
import { AlbumDetailView } from './AlbumDetailView'

export default function AlbumOverlay() {
  const [target, setTarget] = useState<OpenAlbumDetail | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenAlbumDetail>).detail
      if (detail?.albumId)
        setTarget(detail)
    }
    const onNav = () => setTarget(null)
    window.addEventListener(ENT_OPEN_ALBUM, onOpen)
    // Close across ClientRouter view transitions (the overlay is not per-page state).
    document.addEventListener('astro:before-swap', onNav)
    return () => {
      window.removeEventListener(ENT_OPEN_ALBUM, onOpen)
      document.removeEventListener('astro:before-swap', onNav)
    }
  }, [])

  if (!target)
    return null
  return <OverlayCard target={target} onClose={() => setTarget(null)} />
}

function OverlayCard({ target, onClose }: { target: OpenAlbumDetail, onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  useDismissable(true, onClose, cardRef)
  useScrollLock()

  return (
    <div
	className="scrim"
	style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}
	onClick={onClose}
	role="presentation"
    >
      <div
	ref={cardRef}
	className="lf-modal-card"
	onClick={e => e.stopPropagation()}
	role="dialog"
	aria-modal="true"
	aria-label="앨범 상세"
	style={{ position: 'relative', width: '100%', maxWidth: 600, maxHeight: '86vh', overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 34px 80px rgba(0,0,0,.42)', padding: '30px 30px 26px' }}
      >
        <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderColor: 'var(--color-border-soft)', zIndex: 2 }}>✕</button>
        <AlbumDetailView
	albumId={target.albumId}
	title={target.title}
	artist={target.artist}
	cover={target.cover}
	year={target.year}
        />
      </div>
    </div>
  )
}
