// The member board's touch-fallback action sheet — a presentational bottom-sheet
// modal shell (scrim + titled header + a list of tappable actions). Extracted
// verbatim from BucketBoard.tsx by REFACTOR-frontend-member-surface Step 4c; the
// board still builds the action list per target (album / bucket) and owns the
// open/close state, this file owns only the reusable shell. Portals to
// document.body and closes on Escape or a scrim tap. Styling is the global
// `bps-*` sheet classes (member.css).
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface SheetAction { label: string, onClick: () => void, danger?: boolean }

export function ActionSheet({ title, subtitle, actions, onClose }: { title: string, subtitle?: string, actions: SheetAction[], onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div className="bps-scrim" onClick={onClose} role="presentation">
      <div className="bps-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="bps-head">
          <div style={{ minWidth: 0 }}>
            <div className="serif" style={{ fontSize: 17, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {subtitle && <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-subtle)', letterSpacing: '0.04em', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="bps-list">
          {actions.map(a => (
            <button
	key={a.label}
	type="button"
	className="bps-item"
	onClick={a.onClick}
	style={a.danger ? { color: 'var(--color-accent)' } : undefined}
            >
              <span className="serif">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
