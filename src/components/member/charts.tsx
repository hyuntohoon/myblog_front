// Member dashboard — distribution charts (editorial monochrome + accent).
// styles: bar | donut | treemap | tag | list. Ported from charts.jsx.
import type { DistItem } from '@lib/member'

export type ChartStyle = 'bar' | 'donut' | 'treemap' | 'tag' | 'list'

interface Normalized { name: string, value: number, pct: number }

function normalize(items: DistItem[]): Normalized[] {
  const total = items.reduce((s, it) => s + it.value, 0) || 1
  return items.map(it => ({ name: it.name, value: it.value, pct: (it.value / total) * 100 }))
}

/** rank 0 = accent red; rest = descending ink tones (theme-safe). */
function colorFor(i: number) {
  if (i === 0)
    return { bg: 'var(--color-accent)', fg: '#fff' }
  const inkPct = Math.max(26, 72 - i * 9)
  return {
    bg: `color-mix(in srgb, var(--color-text) ${inkPct}%, var(--color-bg))`,
    fg: inkPct > 48 ? 'var(--color-bg)' : 'var(--color-text)',
  }
}

function ChartBar({ items, unit = '' }: { items: Normalized[], unit?: string }) {
  const max = Math.max(...items.map(i => i.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it, i) => (
        <div key={it.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
            <span className="lf-sans" style={{ fontSize: 13, fontWeight: 500, color: i === 0 ? 'var(--color-accent)' : 'var(--color-text)' }}>{it.name}</span>
            <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)' }}>
{it.value}
{unit}
{' '}
·
{it.pct.toFixed(0)}
%
            </span>
          </div>
          <div style={{ height: 7, background: 'var(--color-border-soft)', overflow: 'hidden' }}>
            <div style={{ width: `${(it.value / max) * 100}%`, height: '100%', background: colorFor(i).bg, transition: 'width .9s cubic-bezier(.2,.7,.2,1)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ChartDonut({ items }: { items: Normalized[] }) {
  let acc = 0
  const stops = items.map((it, i) => {
    const start = acc
    acc += it.pct
    return `${colorFor(i).bg} ${start}% ${acc}%`
  }).join(', ')
  const top = items[0]
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 160, height: 160, flex: '0 0 auto' }}>
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: `conic-gradient(${stops})` }} />
        <div style={{ position: 'absolute', inset: 32, borderRadius: '50%', background: 'var(--color-bg)', display: 'grid', placeItems: 'center', textAlign: 'center', boxShadow: 'inset 0 0 0 1px var(--color-border-soft)' }}>
          <div>
            <div className="lf-serif" style={{ fontSize: 30, fontWeight: 500, color: 'var(--color-accent)', lineHeight: 1 }}>
{top.pct.toFixed(0)}
%
            </div>
            <div className="lf-meta" style={{ marginTop: 4 }}>{top.name}</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 160, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 16px' }}>
        {items.map((it, i) => (
          <div key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, background: colorFor(i).bg, flex: '0 0 auto' }} />
            <span className="lf-sans" style={{ fontSize: 12.5, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
            <span className="lf-mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--color-faded)' }}>
{it.pct.toFixed(0)}
%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartTreemap({ items, unit = '' }: { items: Normalized[], unit?: string }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  const rows: (Normalized & { _i: number })[][] = [[], [], []]
  const rowTargets = [0.42, 0.33, 0.25]
  let ri = 0
  let accCap = rowTargets[0] * total
  let run = 0
  items.forEach((it, idx) => {
    if (run > accCap && ri < 2) {
      ri++
      accCap += rowTargets[ri] * total
    }
    rows[ri].push({ ...it, _i: idx })
    run += it.value
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, height: 230 }}>
      {rows.filter(r => r.length).map((row, rIdx) => (
        <div key={rIdx} style={{ display: 'flex', gap: 6, flex: rowTargets[rIdx] }}>
          {row.map((it) => {
            const c = colorFor(it._i)
            return (
              <div
	key={it.name}
	title={`${it.name} · ${it.value}${unit}`}
	style={{ flex: it.value, minWidth: 0, borderRadius: 3, padding: 11, background: c.bg, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}
              >
                <span className="lf-sans" style={{ fontSize: 12.5, fontWeight: 600, color: c.fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
                <span className="lf-mono" style={{ fontSize: 11, fontWeight: 600, color: c.fg, opacity: 0.85 }}>
{it.value}
{unit}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ChartTag({ items }: { items: Normalized[] }) {
  const max = Math.max(...items.map(i => i.value))
  const min = Math.min(...items.map(i => i.value))
  const size = (v: number) => 15 + ((v - min) / (max - min || 1)) * 28
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'baseline', padding: '4px 0' }}>
      {items.map((it, i) => (
        <span
	key={it.name}
	className="lf-serif lf-italic"
	style={{ fontSize: size(it.value), fontWeight: 500, lineHeight: 1.1, letterSpacing: '-.01em', color: i === 0 ? 'var(--color-accent)' : 'var(--color-text)', opacity: i === 0 ? 1 : Math.max(0.45, 1 - i * 0.08) }}
        >
          {it.name}
          <sup className="lf-mono" style={{ fontSize: 10, color: 'var(--color-faded)', marginLeft: 3, fontStyle: 'normal' }}>{it.value}</sup>
        </span>
      ))}
    </div>
  )
}

function ChartList({ items, unit = '' }: { items: Normalized[], unit?: string }) {
  const max = Math.max(...items.map(i => i.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((it, i) => (
        <div key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < items.length - 1 ? '1px solid var(--color-border-soft)' : 'none' }}>
          <span className="lf-mono" style={{ fontSize: 11, color: 'var(--color-faded)', width: 22 }}>{String(i + 1).padStart(2, '0')}</span>
          <span className="lf-serif lf-italic" style={{ fontSize: 15, fontWeight: 500, flex: '0 0 auto', minWidth: 0, color: i === 0 ? 'var(--color-accent)' : 'var(--color-text)' }}>{it.name}</span>
          <div style={{ flex: 1, height: 3, background: 'var(--color-border-soft)', margin: '0 8px', overflow: 'hidden' }}>
            <div style={{ width: `${(it.value / max) * 100}%`, height: '100%', background: colorFor(i).bg }} />
          </div>
          <span className="lf-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
{it.value}
{unit}
          </span>
          <span className="lf-mono" style={{ fontSize: 10.5, color: 'var(--color-faded)', width: 36, textAlign: 'right' }}>
{it.pct.toFixed(0)}
%
          </span>
        </div>
      ))}
    </div>
  )
}

export function DistChart({ style, items, unit = '' }: { style: ChartStyle, items: DistItem[], unit?: string }) {
  const data = normalize(items)
  switch (style) {
    case 'donut': return <ChartDonut items={data} />
    case 'treemap': return <ChartTreemap items={data} unit={unit} />
    case 'tag': return <ChartTag items={data} />
    case 'list': return <ChartList items={data} unit={unit} />
    default: return <ChartBar items={data} unit={unit} />
  }
}
