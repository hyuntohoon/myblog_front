import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
}

interface BubblePos {
  top: number
  left: number
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function readingTime(words: number) {
  return Math.max(1, Math.round(words / 200))
}

function wrapSelection(textarea: HTMLTextAreaElement, before: string, after: string) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = textarea.value.slice(start, end)
  textarea.setRangeText(before + selected + after, start, end, 'select')
  textarea.focus()
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

export default function BodyArea({ value, onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [bubble, setBubble] = useState<BubblePos | null>(null)

  const words = wordCount(value)
  const minutes = readingTime(words)

  const checkSelection = useCallback(() => {
    const ta = textareaRef.current
    if (!ta)
      return

    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim()
    if (!sel) {
      setBubble(null)
      return
    }

    const rect = ta.getBoundingClientRect()
    setBubble({
      top: rect.top - 52,
      left: rect.left + rect.width / 2,
    })
  }, [])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta)
      return
    ta.addEventListener('mouseup', checkSelection)
    ta.addEventListener('keyup', checkSelection)
    return () => {
      ta.removeEventListener('mouseup', checkSelection)
      ta.removeEventListener('keyup', checkSelection)
    }
  }, [checkSelection])

  function handleBold() {
    if (textareaRef.current)
      wrapSelection(textareaRef.current, '**', '**')
    setBubble(null)
  }
  function handleItalic() {
    if (textareaRef.current)
      wrapSelection(textareaRef.current, '_', '_')
    setBubble(null)
  }
  function handleQuote() {
    if (textareaRef.current) {
      const ta = textareaRef.current
      const start = ta.selectionStart
      const selected = ta.value.slice(start, ta.selectionEnd)
      ta.setRangeText(`> ${selected}`, start, ta.selectionEnd, 'select')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setBubble(null)
  }
  function handleParagraph() {
    if (textareaRef.current) {
      const ta = textareaRef.current
      const pos = ta.selectionStart
      ta.setRangeText('\n\n', pos, pos, 'end')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setBubble(null)
  }

  return (
    <div className="wr-body-area">
      {bubble && (
        <div
	className="wr-bubble"
	style={{ top: bubble.top, left: bubble.left, transform: 'translateX(-50%)' }}
        >
          <button type="button" onClick={handleBold} title="굵게"><strong>B</strong></button>
          <button type="button" onClick={handleItalic} title="기울임"><em>I</em></button>
          <button type="button" onClick={handleQuote} title="인용">"</button>
          <button type="button" onClick={handleParagraph} title="단락">¶</button>
        </div>
      )}

      <textarea
	ref={textareaRef}
	className="wr-body-input"
	value={value}
	onChange={e => onChange(e.target.value)}
	placeholder="여기서부터 쓰세요…"
	spellCheck={false}
      />

      <div className="wr-body-footer">
        <span>
          {words.toLocaleString()}
          단어 · 약
          {' '}
          {minutes}
          분
        </span>
      </div>
    </div>
  )
}
