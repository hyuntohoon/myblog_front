// Front UI/UX audit #13 — the Pocket design-settings gear shows only while the
// tray is open. Closed, it stacked over the Pocket pill and doubled the
// bottom-right footprint that covers cards on mobile.
//
// The tray, the playback surfaces and the provider are stubbed: this file only
// pins the gear's mount condition, which reads `open` from usePocket().
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PocketBuckit from './PocketBuckit'

const pocket = vi.hoisted(() => ({ open: false }))

vi.mock('@lib/auth', () => ({ isLoggedIn: () => true }))
vi.mock('./PocketBuckitProvider', () => ({
  PocketBuckitProvider: ({ children }: { children: React.ReactNode }) => children,
  usePocket: () => ({ open: pocket.open, setOpen: vi.fn() }),
}))
vi.mock('./PocketTray', () => ({ PocketTray: () => null }))
vi.mock('./PocketDesignSettings', () => ({ PocketDesignSettings: () => null }))
vi.mock('../playback/YouTubeSurfaces', () => ({ YouTubeSurfaces: () => null }))
vi.mock('../playback/GlobalPlaybackBar', () => ({ GlobalPlaybackBar: () => null }))
vi.mock('../playback/PlaybackPanel', () => ({ PlaybackPanel: () => null }))
vi.mock('../lyrics/LyricsViewer', () => ({ LyricsViewer: () => null }))
vi.mock('../lyrics/LyricsSheet', () => ({ LyricsSheet: () => null }))

describe('pocketBuckit design-settings gear', () => {
  beforeEach(() => {
    pocket.open = false
  })

  it('is absent while the tray is closed', () => {
    render(<PocketBuckit />)
    expect(screen.queryByRole('button', { name: 'Pocket 디자인 설정' })).not.toBeInTheDocument()
  })

  it('shows while the tray is open', () => {
    pocket.open = true
    render(<PocketBuckit />)
    expect(screen.getByRole('button', { name: 'Pocket 디자인 설정' })).toBeInTheDocument()
  })
})
