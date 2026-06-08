import { useCallback, useState } from 'react'
import { useAutoGrow } from './autoGrow'

interface Props {
  body: string
  setBody: (v: string) => void
  dim: boolean
}

interface BubblePos { top: number, left: number }

export default function BodyArea({ body, setBody, dim }: Props) {
  const taRef = useAutoGrow(body)
  const [bubble, setBubble] = useState<BubblePos | null>(null)

  const wrapSelection = useCallback((before: string, after = before) => {
    const ta = taRef.current
    if (!ta)
      return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start === end)
      return
    const sel = body.slice(start, end)
    const next = `${body.slice(0, start)}${before}${sel}${after}${body.slice(end)}`
    setBody(next)
    setTimeout(() => {
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(start + before.length, end + before.length)
    }, 10)
  }, [body, setBody])

  const checkSelection = useCallback(() => {
    const ta = taRef.current
    if (!ta) {
      setBubble(null)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start === end) {
      setBubble(null)
      return
    }
    const rect = ta.getBoundingClientRect()
    const before = body.slice(0, start)
    const linesBefore = before.split('\n').length
    const lineHeight = Number.parseFloat(getComputedStyle(ta).lineHeight)
    const top = rect.top + (linesBefore - 1) * lineHeight - 44
    const left = rect.left + rect.width / 2
    setBubble({ top: Math.max(8, top), left })
  }, [body])

  const onSelect = () => setTimeout(checkSelection, 0)
  const onBlur = () => setTimeout(() => setBubble(null), 200)

  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  const readMin = Math.max(1, Math.round(words / 220))

  return (
    <div className={`body-area${dim ? ' is-dim' : ''}`}>
      {bubble && (
        <div className="bubble-toolbar" style={{ top: bubble.top, left: bubble.left }}>
          <button
	onMouseDown={(e) => {
              e.preventDefault()
              wrapSelection('**')
            }}
	title="굵게"
          >
            <strong>B</strong>
          </button>
          <button
	onMouseDown={(e) => {
              e.preventDefault()
              wrapSelection('*')
            }}
	title="기울임"
          >
            <em>I</em>
          </button>
          <button
	onMouseDown={(e) => {
              e.preventDefault()
              wrapSelection('"')
            }}
	title="인용부호"
          >
            "
          </button>
          <button
	onMouseDown={(e) => {
              e.preventDefault()
              wrapSelection('\n\n> ', '')
            }}
	title="블록 인용"
          >
            ¶
          </button>
        </div>
      )}
      <textarea
	ref={taRef}
	className="body-input"
	placeholder="본문…"
	value={body}
	onChange={(e) => {
          setBody(e.target.value)
        }}
	onSelect={onSelect}
	onMouseUp={onSelect}
	onKeyUp={onSelect}
	onBlur={onBlur}
	spellCheck={false}
      />
      <div className="body-footer">
        <span>
          {words}
          단어 · 약
          {' '}
          {readMin}
          분
        </span>
      </div>
    </div>
  )
}
