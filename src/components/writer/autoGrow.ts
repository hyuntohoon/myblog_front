import { useEffect, useLayoutEffect, useRef } from 'react'

// Native CSS auto-sizing (Chromium 123+). Where present, CSS sizes the textareas
// with zero JS and zero jank (see the @supports block in editor.css) and the JS
// path below early-returns, so the two never fight. Safari/older browsers fall
// back to the scroll-preserving JS resizer.
const NATIVE_FIELD_SIZING = typeof CSS !== 'undefined' &&
	typeof CSS.supports === 'function' &&
	CSS.supports('field-sizing', 'content')

// Grow a window-scrolled textarea to fit its content without the page jumping.
// Measuring needs height='auto', which momentarily shrinks the document so the
// browser clamps window.scrollY; we snapshot and restore it so adding a line
// never nudges the page up and down.
export function autoGrow(el: HTMLTextAreaElement) {
  if (NATIVE_FIELD_SIZING)
    return
  const prevY = window.scrollY
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
  if (window.scrollY !== prevY)
    window.scrollTo(window.scrollX, prevY)
}

// useLayoutEffect runs before paint, so the height='auto' round-trip is never
// painted (no flash). Fall back to useEffect during SSR (the writer island is
// server-rendered) to avoid React's "useLayoutEffect does nothing on the
// server" warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Size a textarea to its content on every value change — one resizer that covers
// typing AND programmatic edits (draft load, reset, subject autofill, selection
// wrap) with no double-collapse. Returns the ref to attach to the textarea.
export function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useIsoLayoutEffect(() => {
    if (ref.current)
      autoGrow(ref.current)
  }, [value])
  return ref
}
