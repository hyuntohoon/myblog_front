// Login-intent sheet (front UI/UX audit 2026-10-16, finding #2 / S5).
//
// A logged-out ＋ used to hand off to the Cognito hosted UI with no warning — an
// unbranded English page whose URL shows `/admin/callback/`. This sheet comes
// first: it says why a login is needed, and only a deliberate choice of provider
// leaves the site. The provider options mirror the header login menu
// (`header.astro` #login-menu): Kakao / Google deep-link through
// `identity_provider`, email falls through to the hosted UI.
//
// It owns no login logic. `onChoose` is where the caller parks its post-login
// intent and calls `goLogin`, so dismissing the sheet leaves nothing behind.
//
// Portaled to body and styled with the GLOBAL color tokens only, for the same
// reason as AddToBucketMenu's picker: it is mounted on public pages that do not
// load member.css.
import type { IdentityProvider } from '@lib/auth'
import type { CSSProperties, ReactNode } from 'react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable } from '@lib/useDismissable'

const SCRIM: CSSProperties = { position: 'fixed', inset: 0, zIndex: 96, background: 'rgba(20,20,20,.32)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }
const SHEET: CSSProperties = { width: 'min(440px, 94vw)', maxHeight: '72vh', overflowY: 'auto', overscrollBehavior: 'contain', background: 'var(--color-bg)', borderRadius: '12px 12px 0 0', border: '1px solid var(--color-border)', borderBottom: 'none', boxShadow: '0 -8px 30px rgba(26,26,26,.22)', padding: '16px 16px 24px', wordBreak: 'keep-all' }
const OPTION: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 14px', fontSize: 14, textAlign: 'left', color: 'var(--color-text)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer' }
const ICON: CSSProperties = { display: 'grid', placeItems: 'center', width: 20, height: 20, flex: 'none', color: 'var(--color-subtle)' }

function KakaoIcon() {
	return (
		<span aria-hidden="true" style={{ ...ICON, background: '#fee500', borderRadius: 6, color: '#191600' }}>
			<svg width="16" height="16" viewBox="0 0 18 18" fill="currentColor"><path d="M9 1.5C4.86 1.5 1.5 4.14 1.5 7.4c0 2.1 1.4 3.94 3.5 5-.15.53-.56 1.98-.64 2.29-.1.38.14.38.29.28.12-.08 1.86-1.26 2.62-1.78.4.06.81.09 1.23.09 4.14 0 7.5-2.64 7.5-5.9S13.14 1.5 9 1.5Z" /></svg>
		</span>
	)
}

function GoogleIcon() {
	return (
		<span aria-hidden="true" style={ICON}>
			<svg width="16" height="16" viewBox="0 0 18 18">
				<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
				<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z" />
				<path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34Z" />
				<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58Z" />
			</svg>
		</span>
	)
}

function EmailIcon() {
	return (
		<span aria-hidden="true" style={ICON}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
<rect x="3" y="5" width="18" height="14" rx="2" />
<path d="m3 7 9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
   </svg>
		</span>
	)
}

const OPTIONS: ReadonlyArray<{ idp: IdentityProvider | undefined, label: string, icon: () => ReactNode }> = [
	{ idp: 'Kakao', label: '카카오로 계속하기', icon: KakaoIcon },
	{ idp: 'Google', label: 'Google로 계속하기', icon: GoogleIcon },
	{ idp: undefined, label: '이메일로 계속하기', icon: EmailIcon },
]

export function LoginIntentSheet({ open, heading, children, onChoose, onClose }: {
	open: boolean
	heading: string
	/** What the visitor was trying to do, and what happens after login. */
	children?: ReactNode
	/** A provider was picked — park any intent, then `goLogin`. */
	onChoose: (idp: IdentityProvider | undefined) => void
	onClose: () => void
}) {
	const sheetRef = useRef<HTMLDivElement>(null)
	// Often opened above another dismissable (the album overlay): register as the top
	// layer so ESC and focus stay here until the sheet closes.
	useDismissable(open, onClose, sheetRef, { lockScroll: true })

	if (!open)
		return null
	return createPortal(
		<div style={SCRIM} onClick={onClose} role="presentation">
			<div ref={sheetRef} style={SHEET} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="login-intent-heading">
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
					<span id="login-intent-heading" style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{heading}</span>
					<button type="button" onClick={onClose} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-subtle)', fontSize: 15 }}>✕</button>
				</div>
				{children && <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-subtle)', marginBottom: 14 }}>{children}</div>}
				<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
					{OPTIONS.map(({ idp, label, icon: Icon }) => (
						<button key={label} type="button" style={OPTION} onClick={() => onChoose(idp)}>
							<Icon />
							<span>{label}</span>
						</button>
					))}
				</div>
			</div>
		</div>,
		document.body,
	)
}
