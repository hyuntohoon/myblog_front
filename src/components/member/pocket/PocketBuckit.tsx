// FEAT-pocket-buckit Step 1 — the site-wide island. Mounted once in layout.astro
// (client:only). Signed-in members only (the bucket read needs a Cognito JWT and
// is per-user since multi-user P2 — each member sees their OWN buckets here);
// anonymous visitors get nothing. Streaming ▶ inside the tray stays owner-only.
import type { PbOpenStateDetail } from '@lib/pocketBuckit/events'
import { useEffect, useRef, useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { PB_CLOSED_EVENT, PB_OPEN_STATE_EVENT, PB_TOGGLE_EVENT } from '@lib/pocketBuckit/events'
import { PocketBuckitProvider, usePocket } from './PocketBuckitProvider'
import { PocketDesignSettings } from './PocketDesignSettings'
import { PocketTray } from './PocketTray'
import './pocket.css'

function PocketBuckitInner() {
  const { open, setOpen } = usePocket()
  const [settings, setSettings] = useState(false)
  // Cross-island toggle bridge: the member My Buckit board (a separate React
  // root) dispatches `pb:toggle` from its toolbar button; flip the in-memory tray
  // `open` here, where usePocket() is inside the provider. setOpen is pure state —
  // no fetch — so the toggle never hits the network. Mirrors the pb:add-track
  // window-event convention (the two islands share no context).
  useEffect(() => {
    const onToggle = () => setOpen(v => !v)
    window.addEventListener(PB_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(PB_TOGGLE_EVENT, onToggle)
  }, [setOpen])
  // Broadcast `open` back to the member board on EVERY transition. The board
  // can't read this island's `open`, so it mirrors `detail.open` for the 🪣 Pocket
  // toggle's aria-expanded. Driving this from useEffect([open]) — not the tray's
  // 닫기 click — means EVERY close path is observed: the 닫기 button AND the board
  // toggle flipping open→false. On a close transition we also re-emit pb:closed so
  // the board clears its transient NEW drag markers regardless of which control
  // closed the tray (the 닫기 button's own pb:closed becomes idempotent). The
  // first run (mount) is `open === false` with no prior true, so it emits the
  // open-state (false) but the close-marker clear is a harmless no-op.
  const prevOpen = useRef(open)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<PbOpenStateDetail>(PB_OPEN_STATE_EVENT, { detail: { open } }),
    )
    if (prevOpen.current && !open)
      window.dispatchEvent(new CustomEvent(PB_CLOSED_EVENT))
    prevOpen.current = open
  }, [open])
  return (
    <div className="pb-scope">
      <PocketTray />
      <button
	type="button"
	aria-label="Pocket 디자인 설정"
	title="Pocket 디자인 설정"
	onClick={() => setSettings(true)}
	style={{
          position: 'fixed',
          right: 22,
          bottom: open ? 152 : 60,
          zIndex: 72,
          width: 34,
          height: 34,
          borderRadius: 34,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-bg)',
          color: 'var(--color-subtle)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 4px 14px rgba(26,26,26,.16)',
          cursor: 'pointer',
          transition: 'bottom .2s',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
        </svg>
      </button>
      {settings && <PocketDesignSettings onClose={() => setSettings(false)} />}
    </div>
  )
}

export default function PocketBuckit() {
  // client:only island → window is always defined here; gate on the owner session.
  if (typeof window !== 'undefined' && !isLoggedIn())
    return null
  return (
    <PocketBuckitProvider>
      <PocketBuckitInner />
    </PocketBuckitProvider>
  )
}
