// FEAT-pocket-buckit Step 1 — the design settings panel. Every axis is a chip row;
// changes apply to the live mounted tray immediately and persist to `pb:design`.
// Gated values (built:false) are DISABLED (never half-apply); the recommended value
// on each axis carries a 추천 badge. Mirrors the configurator's picker.
import type {
  AxisOption,
  PocketEntry,
  PocketInspect,
  PocketOrder,
  PocketOverflow,
  PocketShell,
  PocketTreeDepth,
  PocketWeight,
} from '@lib/pocketBuckit/design'
import {
  DEPTH_OPTS,
  ENTRY_OPTS,
  INSPECT_OPTS,
  isLightDesign,
  ORDER_OPTS,
  OVERFLOW_OPTS,
  SHELL_OPTS,
  WEIGHT_OPTS,
} from '@lib/pocketBuckit/design'
import { usePocket } from './PocketBuckitProvider'

function AxisRow({ axisN, title, opts, value, set, accent = false, disabled = false }: {
  axisN: string
  title: string
  opts: readonly AxisOption<string | number>[]
  value: string | number
  set: (id: string | number) => void
  accent?: boolean
  disabled?: boolean
}) {
  return (
    <div className="pb-axis">
      <div className="pb-axis-h">
        <span className="pb-axis-n">{axisN}</span>
        <span className="pb-axis-t">{title}</span>
      </div>
      <div className="pb-chiprow">
        {opts.map(o => (
          <button
	type="button"
	key={String(o.id)}
	className="pb-chip"
	data-on={value === o.id}
	data-accent={accent || undefined}
	disabled={disabled || !o.built}
	title={o.desc}
	onClick={() => set(o.id)}
          >
            {o.label}
            {o.recommended && <span className="pb-reco">추천</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PocketDesignSettings({ onClose }: { onClose: () => void }) {
  const { design, setDesign, resetDesign, setOpen } = usePocket()
  const lightShell = design.shell === 'f5' || design.shell === 'f6'

  return (
    <div
	className="pb-scope"
	role="dialog"
	aria-label="Pocket 디자인 설정"
	style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', background: 'rgba(10,9,8,.45)' }}
	onClick={onClose}
    >
      <div
	style={{ width: 'min(720px, 96vw)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--color-bg)', borderRadius: '12px 12px 0 0', border: '1px solid var(--color-border)', padding: '22px 24px 30px' }}
	onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <div className="pb-axis-n">Pocket Buckit · 디자인</div>
            <div className="serif" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>트레이 디자인을 골라보세요</div>
            <div className="sans" style={{ fontSize: 11.5, color: 'var(--color-subtle)', marginTop: 4 }}>모든 옵션이 즉시 트레이에 적용됩니다 · 선택은 이 기기에 저장돼요.</div>
          </div>
          <button type="button" className="btn" style={{ padding: '7px 12px', fontSize: 11 }} onClick={onClose}>닫기 ✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AxisRow axisN="OQ1" title="진입 컨트롤" opts={ENTRY_OPTS} value={design.entry} set={v => setDesign({ entry: v as PocketEntry })} />
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <AxisRow axisN="OQ2" title="트레이 셸" opts={SHELL_OPTS} value={design.shell} set={v => setDesign({ shell: v as PocketShell })} />
            <AxisRow axisN="OQ2 · 무게" title={lightShell ? '무게 (F5/F6=라이트 고정)' : '무게'} opts={WEIGHT_OPTS} value={isLightDesign(design) ? 'light' : design.weight} set={v => setDesign({ weight: v as PocketWeight })} accent disabled={lightShell} />
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <AxisRow axisN="OQ3 · 정렬" title="정렬" opts={ORDER_OPTS} value={design.order} set={v => setDesign({ order: v as PocketOrder })} />
            <AxisRow axisN="OQ3 · 오버플로" title="오버플로" opts={OVERFLOW_OPTS} value={design.overflow} set={v => setDesign({ overflow: v as PocketOverflow })} />
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <AxisRow axisN="OQ4" title="트리 깊이" opts={DEPTH_OPTS} value={design.treeDepth} set={v => setDesign({ treeDepth: v as PocketTreeDepth })} />
            <AxisRow axisN="OQ5" title="빠른 점검" opts={INSPECT_OPTS} value={design.inspect} set={v => setDesign({ inspect: v as PocketInspect })} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          <button
	type="button"
	className="btn btn-solid"
	style={{ padding: '9px 14px', fontSize: 11 }}
	onClick={() => {
            setOpen(true)
            onClose()
          }}
          >
            트레이에서 보기 ↓
          </button>
          <button type="button" className="btn" style={{ padding: '9px 14px', fontSize: 11 }} onClick={resetDesign}>기본값으로 복원</button>
        </div>
      </div>
    </div>
  )
}
