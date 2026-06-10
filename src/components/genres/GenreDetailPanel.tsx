import { useMemo } from 'react'
import type { GenreSeed } from '@lib/genres-sample'
import { FAMILY_META, GENRES, RELATION_LABEL, RELATIONS } from '@lib/genres-sample'

/**
 * Read-only detail panel shared by the constellation / cluster design
 * variants. The plate variant keeps its own panel (it also hosts the edit
 * forms). Operates on the static seed — variants are visual prototypes.
 */

interface Props {
  selectedSlug: string | null
  onPick: (slug: string) => void
  emptyHint: string
}

const BY_SLUG = new Map(GENRES.map(g => [g.slug, g]))

export default function GenreDetailPanel({ selectedSlug, onPick, emptyHint }: Props) {
  const selected: GenreSeed | undefined = selectedSlug ? BY_SLUG.get(selectedSlug) : undefined
  const origins = useMemo(() => RELATIONS.filter(r => r.target === selectedSlug), [selectedSlug])
  const descendants = useMemo(() => RELATIONS.filter(r => r.source === selectedSlug), [selectedSlug])

  if (!selected) {
    return (
      <div className="genre-panel-inner genre-panel-empty" key="empty">
        <span className="genre-chrome-kicker">FIELD NOTES</span>
        <p>{emptyHint}</p>
        <ul className="genre-legend genre-legend-families">
          {Object.entries(FAMILY_META).map(([key, meta]) => (
            <li key={key}>
              <span className="genre-family-dot" style={{ background: meta.color }} />
              {meta.label}
            </li>
          ))}
        </ul>
        <p className="genre-panel-note">샘플 데이터 — 이 변형은 보기 전용 프로토타입입니다. 편집 데모는 ① 도판 탭에 있습니다.</p>
      </div>
    )
  }

  const family = selected.family ? FAMILY_META[selected.family] : null

  return (
    <div className="genre-panel-inner" key={selected.slug}>
      <span className="genre-panel-era">
        {selected.eraStart}
        {family && (
          <span className="genre-panel-family">
            <span className="genre-family-dot" style={{ background: family.color }} />
            {family.label}
          </span>
        )}
      </span>
      <h2 className="genre-panel-title">{selected.nameKo}</h2>
      <span className="genre-panel-en">{selected.nameEn}</span>
      <p className="genre-panel-short">{selected.shortDesc}</p>
      {selected.history && (
        <>
          <h3 className="genre-panel-sub">연혁</h3>
          <p className="genre-panel-history">{selected.history}</p>
        </>
      )}
      {origins.length > 0 && (
        <>
          <h3 className="genre-panel-sub">기원 · 상위</h3>
          <ul className="genre-rel-list">
            {origins.map(r => (
              <li key={`${r.source}-${r.type}`}>
                <button type="button" className="genre-rel" onClick={() => onPick(r.source)}>
                  <span className={`genre-rel-tag rel-${r.type}`}>{RELATION_LABEL[r.type]}</span>
                  {BY_SLUG.get(r.source)?.nameKo}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {descendants.length > 0 && (
        <>
          <h3 className="genre-panel-sub">파생</h3>
          <ul className="genre-rel-list">
            {descendants.map(r => (
              <li key={`${r.target}-${r.type}`}>
                <button type="button" className="genre-rel" onClick={() => onPick(r.target)}>
                  <span className={`genre-rel-tag rel-${r.type}`}>{RELATION_LABEL[r.type]}</span>
                  {BY_SLUG.get(r.target)?.nameKo}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
