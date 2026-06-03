// Member dashboard — 라이브러리 tab. SAMPLE data persisted to localStorage in
// Step 1 (a real library-status table/API is a later RFC step). Ported from
// app.jsx LibraryTab + StatusMenu.
import type { DetailTarget, LibraryStatus, SampleAlbum } from '@lib/member'
import { useEffect, useState } from 'react'
import { getLibrary, LIBRARY_KEY } from '@lib/member'
import { Cover, SampleBadge, SectionTitle, Stars } from './ui'

const STATUSES: LibraryStatus[] = ['듣는 중', '들음', '평론함', '위시리스트']

function StatusMenu({ value, onChange }: { value: LibraryStatus, onChange: (v: LibraryStatus) => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open)
      return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button type="button" className="lf-chip" onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {value}
<span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div className="lf-panel" style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, background: 'var(--color-bg)', padding: 4, minWidth: 116, boxShadow: '0 14px 30px -12px rgba(0,0,0,.4)' }}>
          {STATUSES.map(o => (
            <button
	key={o}
	type="button"
	className="lf-mono"
	onClick={() => {
		onChange(o)
		setOpen(false)
	}}
	style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left', padding: '7px 9px', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', borderRadius: 3, background: o === value ? 'var(--color-paper)' : 'none', color: 'var(--color-text)' }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: o === value ? 'var(--color-accent)' : 'var(--color-border)' }} />
{o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function badgeColor(s: LibraryStatus): string {
  if (s === '위시리스트')
    return 'var(--color-faded)'
  if (s === '듣는 중')
    return 'var(--color-accent)'
  return 'var(--color-text)'
}

export function LibraryTab({ onOpen }: { onOpen: (t: DetailTarget) => void }) {
  const [list, setList] = useState<SampleAlbum[]>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LIBRARY_KEY) || 'null')
      if (Array.isArray(s) && s.length)
        return s
    }
    catch { /* ignore */ }
    return getLibrary()
  })
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(list))
    }
    catch { /* ignore */ }
  }, [list])

  const [status, setStatus] = useState<'전체' | LibraryStatus>('전체')
  const filters: ('전체' | LibraryStatus)[] = ['전체', ...STATUSES]
  const view = status === '전체' ? list : list.filter(a => a.status === status)
  const counts = Object.fromEntries(filters.map(s => [s, s === '전체' ? list.length : list.filter(a => a.status === s).length]))
  const setItemStatus = (id: string, val: LibraryStatus) => setList(l => l.map(a => (a.id === id ? { ...a, status: val } : a)))

  return (
    <div>
      <SectionTitle
	kicker={(
<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
{view.length}
장
{' '}
<SampleBadge />
</span>
)}
	title="들은 음악 · 음반"
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {filters.map(s => (
<span key={s} className="lf-chip" data-on={status === s} onClick={() => setStatus(s)}>
{s}
{' '}
<span style={{ opacity: 0.55 }}>{counts[s]}</span>
</span>
))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: '28px 20px' }}>
        {view.map(a => (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div onClick={() => onOpen(a)} style={{ position: 'relative', cursor: 'pointer' }}>
              <Cover label={a.album} square radius={3} />
              {a.status !== '평론함' && <span className="lf-mono" style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#fff', background: badgeColor(a.status!), padding: '3px 6px' }}>{a.status}</span>}
            </div>
            <div>
              <div onClick={() => onOpen(a)} className="lf-serif lf-italic" style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>{a.album}</div>
              <div className="lf-mono" style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{a.artist}</div>
              <div style={{ marginTop: 7, marginBottom: 9 }}>{a.rating != null ? <Stars score={a.rating} size={13} /> : <span className="lf-unrated">미평가</span>}</div>
              <StatusMenu value={a.status!} onChange={v => setItemStatus(a.id, v)} />
            </div>
          </div>
        ))}
        {view.length === 0 && <div className="lf-panel" style={{ padding: 40, textAlign: 'center', gridColumn: '1 / -1' }}><span className="lf-meta">해당 상태의 음반이 없습니다</span></div>}
      </div>
    </div>
  )
}
