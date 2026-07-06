// Member dashboard — shared editorial primitives (ported from the design
// prototype's components.jsx). Scores are native 0–5 (canonical scale).
import type { CSSProperties, ReactNode } from 'react'

export function SampleBadge({ label = '샘플' }: { label?: string }) {
  return <span className="sample" title="샘플 데이터 — 백엔드 연동 예정">{label}</span>
}

export function Cover({ label, size = 56, radius = 3, square = false }: { label: string, size?: number, radius?: number, square?: boolean }) {
  const dim: CSSProperties = square ? { width: '100%', aspectRatio: '1 / 1' } : { width: size, height: size }
  const fs = square ? 'clamp(20px, 4vw, 40px)' : Math.max(12, size * 0.34)
  return (
    <div className="cover" style={{ ...dim, borderRadius: radius }}>
      <span className="cover-ph" style={{ fontSize: fs }}>{(label || '?').slice(0, 2).toUpperCase()}</span>
    </div>
  )
}

/** Real album art when the API supplies a cover URL, else the editorial letter tile. */
export function AlbumArt({ url, label, size = 160 }: { url?: string | null, label: string, size?: number }) {
  if (url) {
    return (
      <img
	src={url}
	alt={label}
	loading="lazy"
	decoding="async"
	style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 3, display: 'block', border: '1px solid var(--color-border)' }}
      />
    )
  }
  return <Cover label={label} square radius={3} size={size} />
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Partial-fill stars from a 0–5 score. */
export function Stars({ score, size = 16 }: { score: number | null, size?: number }) {
  if (score == null)
    return <span className="unrated">미평가</span>
  return (
    <span
	className="stars"
	role="img"
	aria-label={`별점 ${score.toFixed(1)} / 5`}
	style={{ '--star-size': `${size}px`, '--star-pct': `${(score / 5) * 100}%` } as CSSProperties}
    >
      <span className="stars-bg" aria-hidden="true">★★★★★</span>
      <span className="stars-fg" aria-hidden="true">★★★★★</span>
    </span>
  )
}

/** Numeric score in mono, /5. */
export function ScoreNum({ score, size = 13 }: { score: number | null, size?: number }) {
  if (score == null)
    return <span className="mono" style={{ color: 'var(--color-faded)', fontSize: size }}>—</span>
  return (
    <span className="mono" style={{ fontSize: size, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-.01em' }}>
      {score.toFixed(1)}
      <span style={{ color: 'var(--color-faded)', fontWeight: 400 }}>/5</span>
    </span>
  )
}

/** Big editorial stat: serif numeral + mono label. */
export function Stat({ value, label, accent = false }: { value: ReactNode, label: string, accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="serif" style={{ fontSize: 30, fontWeight: 500, lineHeight: 0.95, letterSpacing: '-.02em', color: accent ? 'var(--color-accent)' : 'var(--color-text)' }}>{value}</span>
      <span className="meta">{label}</span>
    </div>
  )
}

/** Masthead-style section header. */
export function SectionTitle({ kicker, title, right, size = 28 }: { kicker?: ReactNode, title: string, right?: ReactNode, size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', borderBottom: '1px solid var(--color-text)', paddingBottom: 12, marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <h2 className="serif" style={{ fontSize: size, fontWeight: 500, letterSpacing: '-.01em', color: 'var(--color-text)', whiteSpace: 'nowrap', margin: 0 }}>{title}</h2>
        {kicker && <span className="meta">{kicker}</span>}
      </div>
      {right}
    </div>
  )
}

/** Animated equalizer (accent + ink bars). */
export function Equalizer({ bars = 4, h = 16, playing = true }: { bars?: number, h?: number, playing?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: h }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span
	key={i}
	className={playing ? 'lf-eq-bar' : undefined}
	style={{
            width: 3,
            height: h,
            borderRadius: 1,
            background: i % 2 ? 'var(--color-accent)' : 'var(--color-text)',
            transformOrigin: 'bottom',
            animationDuration: `${0.7 + (i % 3) * 0.22}s`,
            animationDelay: `${i * 0.12}s`,
            transform: playing ? undefined : 'scaleY(0.3)',
          }}
        />
      ))}
    </span>
  )
}

export function Progress({ pct, h = 3, accent = false }: { pct: number, h?: number, accent?: boolean }) {
  return (
    <div style={{ height: h, background: 'var(--color-border)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: accent ? 'var(--color-accent)' : 'var(--color-text)' }} />
    </div>
  )
}

/** Editorial avatar: paper tile + italic serif initial. */
export function Avatar({ size = 76, name = 'L', square = true }: { size?: number, name?: string, square?: boolean }) {
  return (
    <div
	style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        background: 'var(--color-paper)',
        border: '1px solid var(--color-border)',
        borderRadius: square ? 4 : '50%',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      <span className="serif italic" style={{ fontSize: size * 0.42, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-.03em' }}>
        {name.slice(0, 1)}
      </span>
    </div>
  )
}

/** Mono segmented control. */
export function Seg({ value, options, onChange }: { value: string, options: { v: string, label: string }[], onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)' }}>
      {options.map((o, i) => (
        <button
	key={o.v}
	type="button"
	onClick={() => onChange(o.v)}
	className="mono"
	style={{
            border: 'none',
            borderLeft: i ? '1px solid var(--color-border)' : 'none',
            padding: '6px 11px',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            background: value === o.v ? 'var(--color-text)' : 'transparent',
            color: value === o.v ? 'var(--color-bg)' : 'var(--color-text)',
            transition: 'all .14s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Bucket shortcut card (accent left rail). */
export function BucketShortcut({ count, onGo }: { count: number, onGo: () => void }) {
  return (
    <button
	type="button"
	onClick={onGo}
	className="panel"
	style={{ width: '100%', textAlign: 'left', padding: 0, display: 'flex', alignItems: 'stretch', cursor: 'pointer', overflow: 'hidden', background: 'var(--color-paper)' }}
    >
      <span style={{ width: 4, background: 'var(--color-accent)', flex: '0 0 auto' }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 18, flex: 1 }}>
        <span style={{ flex: 1 }}>
          <span className="kicker" style={{ color: 'var(--color-accent)', display: 'block', marginBottom: 6 }}>평론 대기열</span>
          <span className="serif" style={{ fontSize: 21, fontWeight: 500, display: 'block' }}>My Buckit으로 이동</span>
          <span className="sans" style={{ fontSize: 12.5, color: 'var(--color-subtle)' }}>
아직 평론을 쓰지 않은 앨범
{count}
장이 대기 중
          </span>
        </span>
        <span className="serif" style={{ fontSize: 40, fontWeight: 500, color: 'var(--color-accent)', lineHeight: 1 }}>{count}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text)" strokeWidth="1.6" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
      </span>
    </button>
  )
}
