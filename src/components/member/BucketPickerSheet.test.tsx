// BUG-20: BucketPickerSheet had zero test coverage — the exact place LikedBoard's
// promote-to-bucket flow shipped without a `skip` prop, letting a member add into
// the sync-owned spotify_library mirror bucket (no caller-side guard, no server
// backstop). This pins the `skip` contract itself: a skipped bucket (and its
// subtree) never renders as a pickable entry, and the default (no `skip`) hides
// nothing — so a future caller that forgets `skip` fails loudly in a real render,
// not silently in production.
import type { BoardBucket } from '@lib/buckets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { isManualAddTarget, SLIB_KIND } from '@lib/buckets'
import { BucketPickerSheet } from './BucketPickerSheet'

function bucket(over: Partial<BoardBucket> = {}): BoardBucket {
  return {
    id: 'b',
    name: 'b',
    color: null,
    isDone: false,
    kind: 'review',
    type: 'general',
    isPublic: false,
    researchMode: 'off',
    albums: [],
    children: [],
    ...over,
  }
}

describe('bucketPickerSheet — skip contract', () => {
  it('with no skip prop, every bucket (incl. spotify_library) renders — the caller must opt in', () => {
    render(
      <BucketPickerSheet
	title="담기"
	tree={[bucket({ id: 'general', name: '일반 버킷' }), bucket({ id: 'lib', name: 'Spotify 라이브러리', kind: SLIB_KIND })]}
	onPick={vi.fn()}
	onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('일반 버킷')).toBeInTheDocument()
    expect(screen.getByText('Spotify 라이브러리')).toBeInTheDocument()
  })

  it('with skip={b => !isManualAddTarget(b)}, the spotify_library bucket is hidden', () => {
    render(
      <BucketPickerSheet
	title="My Buckit에 담기"
	tree={[bucket({ id: 'general', name: '일반 버킷' }), bucket({ id: 'lib', name: 'Spotify 라이브러리', kind: SLIB_KIND })]}
	skip={b => !isManualAddTarget(b)}
	onPick={vi.fn()}
	onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('일반 버킷')).toBeInTheDocument()
    expect(screen.queryByText('Spotify 라이브러리')).not.toBeInTheDocument()
  })

  it('skipping a bucket also skips its subtree', () => {
    render(
      <BucketPickerSheet
	title="My Buckit에 담기"
	tree={[bucket({ id: 'lib', name: 'Spotify 라이브러리', kind: SLIB_KIND, children: [bucket({ id: 'nested', name: '중첩 버킷' })] })]}
	skip={b => !isManualAddTarget(b)}
	onPick={vi.fn()}
	onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText('중첩 버킷')).not.toBeInTheDocument()
  })
})
