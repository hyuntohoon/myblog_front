import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ByTheNumbers from './ByTheNumbers'

describe('byTheNumbers genre cell (FEAT-public-surfaces-before-first-review Step 1, audit #18)', () => {
  it('drops the 장르 cell while the count is 0', () => {
    render(<ByTheNumbers stats={{ reviews: 0, albums: 0, genres: 0, lastUpdated: '—' }} />)
    expect(screen.queryByText('장르')).toBeNull()
    expect(screen.getByText('평론')).toBeTruthy()
  })

  it('shows the 장르 cell once a 평론 carries a genre', () => {
    render(<ByTheNumbers stats={{ reviews: 1, albums: 1, genres: 2, lastUpdated: '2026.10.17' }} />)
    expect(screen.getByText('장르')).toBeTruthy()
  })
})
