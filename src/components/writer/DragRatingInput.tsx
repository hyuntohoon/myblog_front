import { useCallback, useEffect, useRef, useState } from 'react'
import PartialStars from './PartialStars'

interface Props {
  value: number
  onChange: (v: number) => void
  max?: number
  size?: number
}

// Drag-continuous star strip. Pointer X within the strip maps to [0, max]
// with 2-decimal precision; click sets the value at the click location;
// drag updates live. The numeric value is shown to the author *only while
// dragging* (author-facing affordance, per RFC Step 4) — it never leaks
// to the published read page.
export default function DragRatingInput({ value, onChange, max = 5, size = 26 }: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [previewValue, setPreviewValue] = useState<number | null>(null)

  const displayValue = previewValue ?? value

  const valueAt = useCallback(
    (clientX: number): number => {
      const el = stripRef.current
      if (!el)
        return 0
      const rect = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
      const raw = (x / rect.width) * max
      // 2-decimal precision; clamp.
      return Math.max(0, Math.min(max, Math.round(raw * 100) / 100))
    },
    [max],
  )

  // Global pointer listeners while dragging so the user can drag outside
  // the strip without losing the gesture.
  useEffect(() => {
    if (!dragging)
      return
    const onMove = (e: PointerEvent) => {
      setPreviewValue(valueAt(e.clientX))
    }
    const onUp = (e: PointerEvent) => {
      const v = valueAt(e.clientX)
      setPreviewValue(null)
      setDragging(false)
      onChange(v)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, valueAt, onChange])

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true)
    setPreviewValue(valueAt(e.clientX))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(Math.max(0, Math.round((value - 0.1) * 100) / 100))
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(Math.min(max, Math.round((value + 0.1) * 100) / 100))
    }
    else if (e.key === 'Home') {
      e.preventDefault()
      onChange(0)
    }
    else if (e.key === 'End') {
      e.preventDefault()
      onChange(max)
    }
  }

  return (
    <div className="hdr-rating-drag">
      <div
	ref={stripRef}
	className={`hdr-rating-strip${dragging ? ' is-dragging' : ''}`}
	role="slider"
	tabIndex={0}
	aria-valuemin={0}
	aria-valuemax={max}
	aria-valuenow={displayValue}
	aria-label={`평점 ${displayValue.toFixed(2)} / ${max}`}
	onPointerDown={onPointerDown}
	onKeyDown={onKeyDown}
      >
        <PartialStars value={displayValue} max={max} size={size} className="is-input" />
      </div>
      <span className={`hdr-rating-live${dragging ? ' on' : ''}`} aria-hidden>
        {displayValue.toFixed(2)}
      </span>
    </div>
  )
}
