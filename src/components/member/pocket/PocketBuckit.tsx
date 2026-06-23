// FEAT-pocket-buckit Step 1 — the site-wide island. Mounted once in layout.astro
// (client:only). Owner-only in v1 (the bucket read needs a Cognito JWT); anonymous
// visitors get nothing until the Step-5 public-page sign-in handoff lands.
import { useState } from 'react'
import { isLoggedIn } from '@lib/auth'
import { PocketBuckitProvider, usePocket } from './PocketBuckitProvider'
import { PocketDesignSettings } from './PocketDesignSettings'
import { PocketTray } from './PocketTray'
import './pocket.css'

function PocketBuckitInner() {
  const { open } = usePocket()
  const [settings, setSettings] = useState(false)
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
