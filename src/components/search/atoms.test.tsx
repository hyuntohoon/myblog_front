import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GCover, gsInitials } from './atoms'

describe('gCover (front audit S2 — CoverImage delegate)', () => {
	it('keeps the search initials rule on the shared placeholder', () => {
		expect(gsInitials('아이유')).toBe('아')
		expect(gsInitials('Frank Ocean')).toBe('FO')
		expect(gsInitials('LIT (Deluxe)')).toBe('LI')
		const { container } = render(<GCover name="아이유" src={null} />)
		const box = container.firstElementChild as HTMLElement
		expect(box.tagName).toBe('SPAN')
		expect(box.className).toBe('gs-cover cover')
		expect(box.dataset.coverState).toBe('fallback')
		expect(box.querySelector('.cover-ph')?.textContent).toBe('아')
	})

	it('renders the image with the name as alt, sized and shaped by props', () => {
		const { container } = render(<GCover name="Blonde" src="https://img.example/a.jpg" size={84} shape="circle" />)
		const box = container.firstElementChild as HTMLElement
		expect(box.querySelector('img')?.getAttribute('alt')).toBe('Blonde')
		expect(box.style.width).toBe('84px')
		expect(box.style.borderRadius).toBe('50%')
	})

	it('leaves the size to the card when size is 0', () => {
		const { container } = render(<GCover name="Blonde" src={null} size={0} />)
		const box = container.firstElementChild as HTMLElement
		expect(box.style.width).toBe('')
		expect(box.style.height).toBe('')
	})
})
