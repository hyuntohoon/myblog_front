// ARCH-entity-interaction-v2 Step 5 (E1 Rule 0, G5) — `ArtistNames`'s id
// acquisition now routes through `spotifyCatalog`'s synchronous cache
// (`getResolvedDbArtistId`), not just the per-component async effect. Pins:
// (1) unresolved renders plain text, resolved renders a link — unchanged
// gate/decision logic; (2) an id another instance already resolved seeds a
// freshly-mounted instance synchronously, on the very first render — no
// flash back to plain text while this instance re-awaits the same promise.
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getResolvedDbArtistId, resolveDbArtistId } from '@lib/spotifyCatalog'
import { ArtistNames } from './NowPlaying'

vi.mock('@lib/spotifyCatalog', () => ({
  resolveDbArtistId: vi.fn(),
  getResolvedDbArtistId: vi.fn(),
}))

const resolveDbArtistIdMock = vi.mocked(resolveDbArtistId)
const getResolvedDbArtistIdMock = vi.mocked(getResolvedDbArtistId)

describe('artistNames — id acquisition (E1 Rule 0, G5)', () => {
  it('renders plain text until resolution lands, then a link', async () => {
    getResolvedDbArtistIdMock.mockReturnValue(undefined)
    let settle: (id: string | null) => void = () => {}
    resolveDbArtistIdMock.mockReturnValue(new Promise((r) => {
      settle = r
    }))

    render(<ArtistNames artists={[{ id: 'sp-1', name: 'Troye Sivan' }]} />)
    expect(screen.getByText('Troye Sivan')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()

    settle('db-1')
    await waitFor(() => expect(screen.getByRole('link')).toBeInTheDocument())
  })

  it('seeds synchronously from the cache when another instance already resolved the id', () => {
    getResolvedDbArtistIdMock.mockImplementation(id => (id === 'sp-2' ? 'db-2' : undefined))
    resolveDbArtistIdMock.mockReturnValue(new Promise(() => {}))

    render(<ArtistNames artists={[{ id: 'sp-2', name: 'Charli xcx' }]} />)
    // First render, before any effect/microtask runs — the link must already
    // be there, not a plain-text flash waiting on its own re-fetch.
    expect(screen.getByRole('link')).toBeInTheDocument()
  })

  it('falls back to the plain text prop when no artists are given', () => {
    getResolvedDbArtistIdMock.mockReturnValue(undefined)
    render(<ArtistNames text="Some Artist" />)
    expect(screen.getByText('Some Artist')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
