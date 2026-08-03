import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

export const DOCK_TEAR_PX = 70
export const DOCK_TEAR_RESIST = 0.35
export const DOCK_TEAR_TILT_MAX = 2

export interface DockPoint { left: number, top: number }
export interface DockSize { width: number, height: number }
export interface DockRect extends DockPoint, DockSize {}

/** Placement state is host-owned so its reserved dock slot can follow the panel. */
export interface DockState {
  docked: boolean
  dragging: boolean
  expect: boolean
  freePos: DockPoint | null
}

export const INITIAL_DOCK: DockState = { docked: true, dragging: false, expect: false, freePos: null }

interface DockTearOptions<T extends HTMLElement> {
  panelRef: RefObject<T | null>
  hostRef: RefObject<HTMLElement | null>
  dock: DockState
  patch: (p: Partial<DockState>) => void
  dockRect: () => DockRect | null
  floatSize: () => DockSize
  restRect: () => DockRect
  clampPos: (left: number, top: number, width: number, height: number) => DockPoint
  inSlot: (x: number, y: number) => boolean
  reducedMotion: boolean
}

interface DragState {
  p0x: number
  p0y: number
  sx: number
  sy: number
  torn: boolean
  lastX: number
  lastT: number
  tilt: number
}

export interface DockTearHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}

/**
 * Shared grab → resist → tear → glide → dock state machine.
 *
 * Hosts supply only geometry because the lyrics seam belongs to a memo modal while
 * the playback seam belongs to the page edge. Keeping those measurements outside
 * the hook lets both surfaces share one interaction without coupling their layouts.
 */
export function useDockTear<T extends HTMLElement>({
  panelRef,
  hostRef,
  dock,
  patch,
  dockRect,
  floatSize,
  restRect,
  clampPos,
  inSlot,
  reducedMotion,
}: DockTearOptions<T>): { handlers: DockTearHandlers, togglePlacement: () => void } {
  const { docked, freePos } = dock
  const dragRef = useRef<DragState | null>(null)

  const apply = useCallback((r: Partial<DockRect>) => {
    const el = panelRef.current
    if (!el)
      return
    if (r.left != null)
      el.style.left = `${r.left}px`
    if (r.top != null)
      el.style.top = `${r.top}px`
    if (r.width != null)
      el.style.width = `${r.width}px`
    if (r.height != null)
      el.style.height = `${r.height}px`
  }, [panelRef])

  const placeResting = useCallback((instant: boolean) => {
    const el = panelRef.current
    if (!el || dragRef.current)
      return
    if (instant)
      el.style.transition = 'none'
    if (docked) {
      const r = dockRect()
      if (r)
        apply(r)
    }
    else {
      const s = floatSize()
      const pos = freePos ? clampPos(freePos.left, freePos.top, s.width, s.height) : restRect()
      apply({ ...s, ...pos })
    }
    if (instant) {
      void el.offsetHeight
      el.style.transition = ''
    }
  }, [apply, clampPos, dockRect, docked, floatSize, freePos, panelRef, restRect])

  const mounted = useRef(false)
  useLayoutEffect(() => {
    placeResting(!mounted.current)
    mounted.current = true
  }, [placeResting])

  useEffect(() => {
    const onResize = () => placeResting(true)
    window.addEventListener('resize', onResize)
    const host = hostRef.current
    let observer: ResizeObserver | null = null
    if (host && 'ResizeObserver' in window) {
      observer = new ResizeObserver(() => {
        if (dock.docked && !dragRef.current)
          placeResting(false)
      })
      observer.observe(host)
    }
    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [dock.docked, hostRef, placeResting])

  const setClass = useCallback((add: string[], remove: string[]) => {
    const el = panelRef.current
    if (!el)
      return
    el.classList.add(...add)
    el.classList.remove(...remove)
  }, [panelRef])

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || dragRef.current)
      return
    if ((e.target as HTMLElement).closest('button'))
      return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    catch { /* pointer released early — bubbling still tracks the drag */ }
    const el = panelRef.current
    if (!el)
      return
    dragRef.current = {
      p0x: e.clientX,
      p0y: e.clientY,
      sx: el.offsetLeft,
      sy: el.offsetTop,
      torn: !docked,
      lastX: e.clientX,
      lastT: performance.now(),
      tilt: 0,
    }
    setClass(['is-grabbed', 'is-lifted', ...(docked ? ['is-straining'] : [])], [])
    patch({ dragging: true })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d)
      return
    const dx = e.clientX - d.p0x
    const dy = e.clientY - d.p0y

    if (!d.torn) {
      if (Math.hypot(dx, dy) < DOCK_TEAR_PX) {
        apply({ left: d.sx + dx * DOCK_TEAR_RESIST, top: d.sy + dy * DOCK_TEAR_RESIST })
        return
      }
      d.torn = true
      setClass([], ['is-straining'])
      patch({ docked: false })
      const s = floatSize()
      d.sx = e.clientX - s.width * 0.4
      d.sy = e.clientY - 24
      d.p0x = e.clientX
      d.p0y = e.clientY
      apply({ left: d.sx, top: d.sy, ...s })
      return
    }

    if (!reducedMotion) {
      const now = performance.now()
      const vx = (e.clientX - d.lastX) / Math.max(1, now - d.lastT)
      d.lastX = e.clientX
      d.lastT = now
      const target = Math.max(-DOCK_TEAR_TILT_MAX, Math.min(DOCK_TEAR_TILT_MAX, vx * 3))
      d.tilt = d.tilt * 0.7 + target * 0.3
      if (panelRef.current)
        panelRef.current.style.transform = `rotate(${d.tilt.toFixed(2)}deg)`
    }
    const el = panelRef.current
    if (!el)
      return
    apply(clampPos(d.sx + dx, d.sy + dy, el.offsetWidth, el.offsetHeight))
    patch({ expect: inSlot(e.clientX, e.clientY) })
  }

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d)
      return
    const wasTorn = d.torn
    const overSlot = wasTorn && inSlot(e.clientX, e.clientY)
    dragRef.current = null
    setClass([], ['is-grabbed', 'is-lifted', 'is-straining'])
    if (panelRef.current)
      panelRef.current.style.transform = ''

    if (!wasTorn) {
      patch({ dragging: false, expect: false })
      placeResting(false)
      return
    }
    if (overSlot) {
      patch({ docked: true, dragging: false, expect: false, freePos: null })
    }
    else {
      const el = panelRef.current
      if (!el)
        return
      const pos = clampPos(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight)
      patch({ dragging: false, expect: false, freePos: pos })
    }
  }

  const togglePlacement = () => {
    if (dragRef.current)
      return
    patch(docked ? { docked: false, freePos: null } : { docked: true, freePos: null })
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    togglePlacement,
  }
}
