import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CoverImage } from './CoverImage'

describe('coverImage (front audit S2)', () => {
	it('renders the image with the label as its accessible name', () => {
		const { container } = render(<CoverImage src="https://img.example/a.jpg" label="Blonde" className="x__cover" />)
		const box = container.firstElementChild as HTMLElement
		expect(box.className).toBe('x__cover cover')
		expect(box.dataset.coverState).toBe('image')
		const img = box.querySelector('img')!
		expect(img.getAttribute('alt')).toBe('Blonde')
		expect(img.getAttribute('loading')).toBe('lazy')
		expect(box.querySelector('.cover-ph')).toBeNull()
	})

	it('renders the two-letter placeholder when there is no image', () => {
		const { container } = render(<CoverImage src={null} label="blonde" placeholderStyle={{ fontSize: 20 }} />)
		const box = container.firstElementChild as HTMLElement
		expect(box.className).toBe('cover')
		expect(box.dataset.coverState).toBe('fallback')
		const ph = box.querySelector('.cover-ph') as HTMLElement
		expect(ph.textContent).toBe('BL')
		expect(ph.getAttribute('aria-hidden')).toBe('true')
		expect(ph.style.fontSize).toBe('20px')
		expect(box.querySelector('img')).toBeNull()
	})

	it('renders a skeleton while loading, even with an image url', () => {
		const { container } = render(<CoverImage src="https://img.example/a.jpg" label="" loading skeletonClassName="x__skel" />)
		const box = container.firstElementChild as HTMLElement
		expect(box.dataset.coverState).toBe('loading')
		expect(box.querySelector('.x__skel')).not.toBeNull()
		expect(box.querySelector('img, .cover-ph')).toBeNull()
	})

	it('draws overlays inside the cover box', () => {
		const { container } = render(<CoverImage src={null} label=""><span className="badge">B</span></CoverImage>)
		expect(container.querySelector('.cover > .badge')).not.toBeNull()
		expect(container.querySelector('.cover-ph')?.textContent).toBe('?')
	})

	it('takes a surface wrapper element and initials rule', () => {
		const { container } = render(<CoverImage as="span" src={null} label="아이유" initials="아" className="gs-cover" />)
		const box = container.firstElementChild as HTMLElement
		expect(box.tagName).toBe('SPAN')
		expect(box.className).toBe('gs-cover cover')
		expect(box.querySelector('.cover-ph')?.textContent).toBe('아')
	})
})
