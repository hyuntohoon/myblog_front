// FEAT-pocket-buckit Step 1 — the user-selectable Pocket Buckit *design* setting.
//
// The owner directive: the Pocket Buckit design is not a single hard pick — every
// design is usable via a settings option. This module is the single source of truth
// for that: one typed `PocketBuckitDesign` object (the five atlas axes + a weight),
// the axis OPTION TABLES (lifted from the claude.ai/design interactive configurator,
// `atlas-configurator.jsx`, so the settings panel and the `PocketTray` dispatcher read
// the same registry), and the pure resolver/persistence helpers.
//
// Persisted as ONE atomic localStorage blob under `pb:design` (single-owner v1, no
// owner_id). A future per-owner namespace is an additive `pb:design:<sub>` — there is
// no global-singleton / `id=1` shape here, so per-owner generalization stays additive
// (RFC FEAT-pocket-buckit D5/OQ12).

export type PocketEntry = 'single' | 'dual-same' | 'dual-filtered'
export type PocketShell = 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'
export type PocketWeight = 'editorial' | 'light'
export type PocketOrder = 'pinned' | 'recent' | 'contextual'
export type PocketOverflow = 'scroll' | 'more' | 'search'
export type PocketTreeDepth = 0 | 1 | 2
export type PocketInspect = 'above' | 'card' | 'side' | 'drawer'

export interface PocketBuckitDesign {
  /** OQ1 — entry-control model. */
  entry: PocketEntry
  /** OQ2 — tray-shell family. */
  shell: PocketShell
  /** OQ2 — shell weight; ignored / forced 'light' when shell ∈ {f5,f6}. */
  weight: PocketWeight
  /** OQ3 — resting rail order. */
  order: PocketOrder
  /** OQ3 — many-bucket overflow strategy. */
  overflow: PocketOverflow
  /** OQ4 — in-tray tree-navigation depth before handing off to the full page. */
  treeDepth: PocketTreeDepth
  /** OQ5 — quick-inspection surface. */
  inspect: PocketInspect
  /** Bumped when the persisted shape changes; drives forward-compat migration. */
  schemaVersion: number
}

export const POCKET_DESIGN_SCHEMA_VERSION = 1

/** localStorage key — one atomic JSON blob (not key-per-axis). */
export const POCKET_DESIGN_KEY = 'pb:design'

/**
 * The shipped recommended default (RFC OQ 1–5 / D9). The owner's LIGHT lean is routed
 * into the `weight` axis (F2-editorial at light weight keeps named, individually
 * droppable destination containers + at-a-glance legibility) rather than into F5/F6,
 * which ship real and selectable for maximum lightness.
 */
export const POCKET_DESIGN_DEFAULTS: PocketBuckitDesign = {
  entry: 'single',
  shell: 'f2',
  weight: 'light',
  order: 'pinned',
  overflow: 'more',
  treeDepth: 1,
  inspect: 'above',
  schemaVersion: POCKET_DESIGN_SCHEMA_VERSION,
}

// ── axis option tables ───────────────────────────────────────────────────────
// `built:false` marks a value that appears in the registry but is gated off until a
// later step wires its data — the settings panel DISABLES these (never half-applies).
// Per the owner directive every *design* value is usable on the existing album buckets,
// so all axis values below are `built:true`; only deeper feature capabilities
// (generalized non-album item types, playback) gate at the feature level, not here.

export interface AxisOption<T extends string | number> {
  id: T
  /** Korean label shown in the picker. */
  label: string
  /** stable English token used in the RFC / logs / readout. */
  en: string
  /** one-line Korean tradeoff. */
  desc: string
  /** false = gated (disabled in the picker until built). */
  built: boolean
  /** true = the recommended default value on this axis. */
  recommended?: boolean
  /** shell-only: this family is light-weight (no editorial variant). */
  lightOnly?: boolean
}

export const ENTRY_OPTS: readonly AxisOption<PocketEntry>[] = [
  { id: 'single', label: '단일 토글', en: 'single-toggle', desc: '한 컨트롤이 전체 트레이 토글 · 가장 단순, 좌/우 분기 없음', built: true, recommended: true },
  { id: 'dual-same', label: '좌·우 둘 · 같은 트레이', en: 'dual-same-tray', desc: '양손 도달성 ↑ · 두 컨트롤 모두 동일 트레이를 엶', built: true },
  { id: 'dual-filtered', label: '좌·우 둘 · 필터 뷰', en: 'dual-filtered-views', desc: '같은 트리, 다른 투영 — 좌=듣기/재생, 우=평론/요약', built: true },
] as const

export const SHELL_OPTS: readonly AxisOption<PocketShell>[] = [
  { id: 'f1', label: 'F1 탱저블 버킷 행', en: 'tangible-row', desc: '컨테이너 은유 — 어느 버킷에 담기는지 가장 직관적, 세로 공간 더 씀', built: true },
  { id: 'f2', label: 'F2 에디토리얼 셸프', en: 'editorial-shelf', desc: '잡지 선반 — 본문과 자연스럽게 섞임 (추천 기본)', built: true, recommended: true },
  { id: 'f3', label: 'F3 모듈러 유틸 독', en: 'utility-dock', desc: '어두운 독 — 밀도/스캔성 최고, 본문 대비 큼', built: true },
  { id: 'f4', label: 'F4 이머시브 워크스페이스', en: 'immersive', desc: '반투명 글래스 — 재생 맥락 강함, 본문 살짝 가림', built: true },
  { id: 'f5', label: 'F5 플로팅 핀/칩', en: 'floating-pill', desc: '바가 아님 — 떠 있는 반투명 칩 (ultra-light)', built: true, lightOnly: true },
  { id: 'f6', label: 'F6 스티커 셸프', en: 'sticker-shelf', desc: '친근한 스티커/토큰 타일 · 드롭 시 바운스 (casual)', built: true, lightOnly: true },
] as const

export const WEIGHT_OPTS: readonly AxisOption<PocketWeight>[] = [
  { id: 'editorial', label: 'Editorial', en: 'editorial', desc: '불투명 에디토리얼 셸 · 애니메이션 없음', built: true },
  { id: 'light', label: 'Light', en: 'light', desc: '반투명 · 본문 비침 · 캐주얼 라운드 (추천)', built: true, recommended: true },
] as const

export const ORDER_OPTS: readonly AxisOption<PocketOrder>[] = [
  { id: 'pinned', label: '고정 (pinned)', en: 'pinned', desc: '핀한 버킷 우선 · 드래그 중 절대 재정렬 안 함 (추천)', built: true, recommended: true },
  { id: 'recent', label: '최근 (recent)', en: 'recent', desc: '최근 추가/사용한 버킷을 앞에', built: true },
  { id: 'contextual', label: '맥락 (contextual)', en: 'contextual', desc: '현재 페이지 맥락 우선 — 평론 페이지면 평론계열 먼저', built: true },
] as const

export const OVERFLOW_OPTS: readonly AxisOption<PocketOverflow>[] = [
  { id: 'more', label: '더보기 (+N)', en: 'more', desc: '처음 N개 + “+N 더보기”로 핸드오프 (추천)', built: true, recommended: true },
  { id: 'scroll', label: '가로 스크롤', en: 'scroll', desc: '한 줄 유지 · 옆으로 스크롤 (페이드 힌트)', built: true },
  { id: 'search', label: '검색', en: 'search', desc: '버킷이 많을 때 검색으로 좁힘', built: true },
] as const

export const DEPTH_OPTS: readonly AxisOption<PocketTreeDepth>[] = [
  { id: 0, label: '깊이 0 · 평면', en: 'depth-0', desc: '핀한 리프만 · 더 깊으면 전체 페이지로', built: true },
  { id: 1, label: '깊이 1 · 한 단계', en: 'depth-1', desc: '상위 폴더를 골라 그 리프까지 트레이 안에서 (추천)', built: true, recommended: true },
  { id: 2, label: '깊이 2 · 두 단계', en: 'depth-2', desc: '폴더▸하위폴더▸리프까지 · 세로 폴더 탐색기로 전락 주의', built: true },
] as const

export const INSPECT_OPTS: readonly AxisOption<PocketInspect>[] = [
  { id: 'above', label: '트레이 위 패널', en: 'inspect-above-tray', desc: '트레이 바로 위에 떠오름 · 한 쌍으로 읽힘 (추천)', built: true, recommended: true },
  { id: 'card', label: '확장형 카드', en: 'expandable-card', desc: '카드 자체가 인라인 확장 · 맥락 이탈 최소', built: true },
  { id: 'side', label: '사이드 픽', en: 'side-peek', desc: '우측에서 슬라이드 · 재정렬/핀 작업에 유리', built: true },
  { id: 'drawer', label: '미니 드로어', en: 'mini-drawer', desc: '작은 하단 드로어 · 한 손 · 모바일 일관', built: true },
] as const

// ── resolver ─────────────────────────────────────────────────────────────────

function allow<T extends string | number>(opts: readonly AxisOption<T>[], v: unknown, fallback: T): T {
  return opts.some(o => o.id === v) ? (v as T) : fallback
}

/**
 * Coerce an arbitrary (possibly stale / partial) persisted value into a valid
 * `PocketBuckitDesign`: clamp unknown/removed enum values back to the default, fill
 * missing axes, and force `weight:'light'` when the shell is light-only (F5/F6).
 * Never throws — a corrupt blob degrades silently to the defaults.
 */
export function normalizeDesign(partial: Partial<PocketBuckitDesign> | null | undefined): PocketBuckitDesign {
  const d = POCKET_DESIGN_DEFAULTS
  const p = partial ?? {}
  const shell = allow(SHELL_OPTS, p.shell, d.shell)
  const lightOnly = SHELL_OPTS.find(o => o.id === shell)?.lightOnly ?? false
  return {
    entry: allow(ENTRY_OPTS, p.entry, d.entry),
    shell,
    weight: lightOnly ? 'light' : allow(WEIGHT_OPTS, p.weight, d.weight),
    order: allow(ORDER_OPTS, p.order, d.order),
    overflow: allow(OVERFLOW_OPTS, p.overflow, d.overflow),
    treeDepth: allow(DEPTH_OPTS, p.treeDepth, d.treeDepth),
    inspect: allow(INSPECT_OPTS, p.inspect, d.inspect),
    schemaVersion: POCKET_DESIGN_SCHEMA_VERSION,
  }
}

/** True when the resolved design renders via the light engine (light weight or F5/F6). */
export function isLightDesign(d: PocketBuckitDesign): boolean {
  return d.weight === 'light' || d.shell === 'f5' || d.shell === 'f6'
}

/**
 * The engine family string the `PocketTray` dispatcher feeds to the ported atlas
 * engines: F5/F6 are their own light families; F1–F4 map to `f{n}l` under light
 * weight, else the editorial `f{n}`.
 */
export function engineFamily(d: PocketBuckitDesign): string {
  if (d.shell === 'f5' || d.shell === 'f6')
    return d.shell
  return d.weight === 'light' ? `${d.shell}l` : d.shell
}

// ── persistence (SSR-safe; mirrors the existing theme provider's mount-read) ──

/** Read + normalize the persisted design. SSR / corrupt / absent → defaults. */
export function readDesign(): PocketBuckitDesign {
  if (typeof localStorage === 'undefined')
    return POCKET_DESIGN_DEFAULTS
  try {
    const raw = localStorage.getItem(POCKET_DESIGN_KEY)
    if (!raw)
      return POCKET_DESIGN_DEFAULTS
    return normalizeDesign(JSON.parse(raw) as Partial<PocketBuckitDesign>)
  }
  catch {
    return POCKET_DESIGN_DEFAULTS
  }
}

/** Persist the whole normalized design under the single key. No-op on SSR. */
export function writeDesign(d: PocketBuckitDesign): void {
  if (typeof localStorage === 'undefined')
    return
  try {
    localStorage.setItem(POCKET_DESIGN_KEY, JSON.stringify(normalizeDesign(d)))
  }
  catch { /* ignore quota / disabled storage */ }
}
