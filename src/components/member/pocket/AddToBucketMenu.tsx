// FEAT-pocket-buckit Step 5 — the non-drag "Add to bucket" affordance (the WCAG
// 2.5.7 PRIMARY path; DnD onto the tray stays deferred). Given an `AddTarget`
// (an album OR — FEAT-pocket-buckit Step 6 — a track), it adds a non-destructive
// membership to a chosen leaf bucket with a bucket-local Undo.
//
// SELF-CONTAINED BY DESIGN: it can be mounted on member pages, the home resume
// banner, or a public drop source (the review hero album + per-track adder).
// member.css (the .bps-*/.lf-* sheet styles) is NOT loaded outside /profile, so
// this component brings its own portal sheet + toast styled with only the GLOBAL
// color tokens — never reusing BucketPickerSheet, which would render unstyled off
// the member pages.
//
// Auth split: when logged out there are no buckets and every write is 401/403, so
// it stashes a thin pending-intent (album or track) and hands off to Cognito PKCE;
// the home resume completes the add after sign-in (see lib/pocketBuckit/intent.ts).
import type { BoardBucket } from '@lib/buckets'
import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { goLogin, isLoggedIn } from '@lib/auth'
import { addBucketItem, addBucketTrack, deleteBucketItem, listBuckets } from '@lib/buckets'
import { writePocketIntent } from '@lib/pocketBuckit/intent'

// What to add: an album (default, back-compat) or a track (FEAT-pocket-buckit
// Step 6). A tagged union so each kind carries exactly its own target id.
export type AddTarget =
	| { itemType?: 'album', albumId: string, title: string } |
	{ itemType: 'track', trackId: string, title: string }

interface FlatBucket { id: string, name: string, depth: number }

// Flatten the tree to a depth-tagged list. The Spotify-library mirror is not a
// manual add target (it's sync-owned), so its subtree is skipped.
function flatten(buckets: BoardBucket[], depth: number, out: FlatBucket[]) {
  for (const b of buckets) {
    if (b.kind === 'spotify_library')
      continue
    out.push({ id: b.id, name: b.name, depth })
    flatten(b.children, depth + 1, out)
  }
}

interface ToastState { label: string, undo: (() => void) | null }

const SCRIM: CSSProperties = { position: 'fixed', inset: 0, zIndex: 96, background: 'rgba(20,20,20,.32)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }
const SHEET: CSSProperties = { width: 'min(440px, 94vw)', maxHeight: '62vh', overflowY: 'auto', background: 'var(--color-bg)', borderRadius: '12px 12px 0 0', border: '1px solid var(--color-border)', borderBottom: 'none', boxShadow: '0 -8px 30px rgba(26,26,26,.22)', padding: '14px 14px 22px' }
const ITEM: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '11px 12px', background: 'none', border: 'none', borderRadius: 7, cursor: 'pointer', color: 'var(--color-text)', fontSize: 14 }
const TOAST: CSSProperties = { position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 101, display: 'flex', alignItems: 'center', gap: 14, background: 'var(--color-text)', color: 'var(--color-bg)', borderRadius: 6, padding: '10px 16px', fontSize: 13, boxShadow: '0 6px 22px rgba(26,26,26,.28)' }

export function AddToBucketMenu({ item, label = '버킷에 담기', autoOpen = false, onResolved, render }: {
  item: AddTarget
  label?: string
  /** open the picker immediately on mount — used by the post-login home resume. */
  autoOpen?: boolean
  /** fired after the add resolves OR the sheet is cancelled (resume self-dismiss). */
  onResolved?: () => void
  /** custom trigger; defaults to a small bordered "버킷에 담기" button. */
  render?: (p: { open: () => void, busy: boolean }) => ReactNode
}) {
  const [tree, setTree] = useState<BoardBucket[] | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const busy = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flatten the union to primitives so `open`/`pick` stay referentially stable
  // (the autoOpen effect depends on `open`'s identity — a fresh `item` object each
  // render must not re-fire it). Exactly one of albumId/trackId is set per kind.
  const title = item.title
  const isTrack = item.itemType === 'track'
  const trackId = item.itemType === 'track' ? item.trackId : undefined
  const albumId = item.itemType === 'track' ? undefined : item.albumId

  const showToast = useCallback((t: ToastState) => {
    if (toastTimer.current)
      clearTimeout(toastTimer.current)
    setToast(t)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current)
      clearTimeout(toastTimer.current)
  }, [])

  const open = useCallback(() => {
    // Anonymous: capture intent + hand off to Cognito PKCE. Never attempts a write
    // that would 401/403; the home resume finishes the add after sign-in.
    if (!isLoggedIn()) {
      if (trackId)
        writePocketIntent({ itemType: 'track', trackId, title, bucketId: null })
      else if (albumId)
        writePocketIntent({ itemType: 'album', albumId, title, bucketId: null })
      void goLogin()
      return
    }
    setLoading(true)
    listBuckets()
      .then((t) => {
        setTree(t)
        setSheetOpen(true)
      })
      .catch(() => showToast({ label: '버킷을 불러오지 못했어요', undo: null }))
      .finally(() => setLoading(false))
  }, [trackId, albumId, title, showToast])

  // resume / explicit auto-open. `open` is a stable useCallback, so this runs once
  // (on mount when autoOpen is set); the intent is already single-drained upstream.
  useEffect(() => {
    if (autoOpen)
      open()
  }, [autoOpen, open])

  const cancel = useCallback(() => {
    setSheetOpen(false)
    onResolved?.()
  }, [onResolved])

  const pick = useCallback(async (bucketId: string) => {
    if (busy.current)
      return
    busy.current = true
    try {
      const { item: added, conflict } = trackId ?
        await addBucketTrack(bucketId, trackId) :
        await addBucketItem(bucketId, albumId!)
      setSheetOpen(false)
      if (conflict) {
        showToast({ label: '이미 담겨 있어요', undo: null })
      }
      else if (added) {
        showToast({
          label: `${title} 담음`,
          // Best-effort restore; swallow a network failure so a failed undo can't
          // surface as an unhandled rejection (the toast already reported the add).
          undo: () => {
            deleteBucketItem(bucketId, added.itemId).catch(() => {})
          },
        })
      }
    }
    catch {
      showToast({ label: '담기에 실패했어요', undo: null })
    }
    finally {
      busy.current = false
      onResolved?.()
    }
  }, [trackId, albumId, title, showToast, onResolved])

  const entries: FlatBucket[] = []
  if (tree)
    flatten(tree, 0, entries)

  return (
    <>
      {render ?
        render({ open, busy: loading }) :
        (
          <button
	type="button"
	onClick={open}
	disabled={loading}
	style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', fontSize: 12.5, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
<line x1="12" y1="5" x2="12" y2="19" />
<line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {label}
          </button>
        )}

      {sheetOpen && tree && createPortal(
        <div style={SCRIM} onClick={cancel} role="presentation">
          <div style={SHEET} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="버킷 선택">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, padding: '0 4px' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
                «
                {title}
                »
                {isTrack && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-subtle)', fontFamily: 'var(--font-mono, monospace)' }}> 트랙</span>}
                {' '}
                담기
              </span>
              <button type="button" onClick={cancel} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-subtle)', fontSize: 15 }}>✕</button>
            </div>
            {entries.length === 0 ?
              <div style={{ padding: '18px 12px', fontSize: 13, color: 'var(--color-faded)' }}>버킷이 없어요. /profile에서 먼저 버킷을 만들어 주세요.</div> :
              entries.map(e => (
                <button
	key={e.id}
	type="button"
	style={{ ...ITEM, paddingLeft: 12 + e.depth * 18 }}
	onClick={() => void pick(e.id)}
                >
                  {e.depth > 0 && <span style={{ color: 'var(--color-faded)', fontFamily: 'var(--font-mono, monospace)' }}>└</span>}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                </button>
              ))}
          </div>
        </div>,
        document.body,
      )}

      {toast && createPortal(
        <div style={TOAST} role="status">
          <span>{toast.label}</span>
          {toast.undo && (
            <button
	type="button"
	onClick={() => {
                toast.undo?.()
                setToast(null)
              }}
	style={{ border: 'none', background: 'none', color: 'var(--color-bg)', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}
            >
              되돌리기
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
