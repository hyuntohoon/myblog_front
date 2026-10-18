// `/members/?me` resolves the signed-in member's handle via /api/me. A null answer
// that reaches this component is a 5xx / throttle / timeout — a genuine auth failure
// has already navigated to login inside apiFetch — so it must NOT start a second
// login: that sent still-signed-in members to the login form over a cold start.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ isLoggedIn: vi.fn(() => true), goLogin: vi.fn() }))
const me = vi.hoisted(() => ({ getMe: vi.fn() }))
vi.mock('@lib/auth', () => auth)
vi.mock('./me.api', () => me)
vi.mock('./MemberProfile', () => ({ default: ({ handle }: { handle: string }) => (
<p>
profile:
{handle}
</p>
) }))

beforeEach(() => {
  window.history.replaceState(null, '', '/members/?me')
  auth.goLogin.mockClear()
  me.getMe.mockReset()
})
afterEach(cleanup)

describe('membersHub ?me', () => {
  it('shows a retry instead of the login form when /api/me does not answer', async () => {
    me.getMe.mockResolvedValueOnce(null).mockResolvedValueOnce({ handle: 'me-handle' })
    const { default: MembersHub } = await import('./MembersHub')
    render(<MembersHub />)

    const retry = await screen.findByRole('button', { name: '다시 시도' })
    expect(auth.goLogin).not.toHaveBeenCalled()

    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('profile:me-handle')).toBeTruthy())
    expect(auth.goLogin).not.toHaveBeenCalled()
  })

  it('still sends a logged-out visitor to login', async () => {
    auth.isLoggedIn.mockReturnValueOnce(false)
    const { default: MembersHub } = await import('./MembersHub')
    render(<MembersHub />)
    expect(auth.goLogin).toHaveBeenCalledWith(true)
  })
})
