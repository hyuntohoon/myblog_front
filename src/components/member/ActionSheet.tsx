// The member board's touch-fallback action sheet — a presentational bottom-sheet
// modal shell (scrim + titled header + a list of tappable actions). Extracted
// verbatim from BucketBoard.tsx by REFACTOR-frontend-member-surface Step 4c; the
// board still builds the action list per target (album / bucket) and owns the
// open/close state, this file owns only the reusable shell. Portals to
// document.body and closes on Escape or a scrim tap. Styling is the global
// `bps-*` sheet classes (member.css).
//
// A11Y-modal-background-inert Step 2 — this sheet declared itself modal
// (`role="dialog" aria-modal="true"`) but never adopted `useDismissable`, so it
// had no focus trap and no focus restore, and its own `window` ESC listener sat
// outside `openStack`: it fired even when this sheet was not the top layer.
// `useDismissable` replaces both that listener and the bare `useScrollLock`, and
// carries background `inert` in from Step 1.
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable } from '@lib/useDismissable'

export interface SheetAction { label: string, onClick: () => void, danger?: boolean }

export function ActionSheet({ title, subtitle, actions, onClose }: { title: string, subtitle?: string, actions: SheetAction[], onClose: () => void }) {
  // The sheet, not the scrim, is the dialog — the trap and the autofocus target
  // are its contents. The scrim stays the click-to-dismiss surface.
  const sheetRef = useRef<HTMLDivElement>(null)
  useDismissable(true, onClose, sheetRef, { lockScroll: true })
  return createPortal(
    <div className="bps-scrim" onClick={onClose} role="presentation">
      <div ref={sheetRef} className="bps-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
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
