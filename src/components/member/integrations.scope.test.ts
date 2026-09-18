// FEAT-lyrics-listening-experience Step 5 — the follow scope joins the grant.
//
// `user-follow-read` was not in the authorize URL before this step, so EVERY member who
// connected earlier holds a grant without it. That makes the "missing scope" state the
// common case rather than the rare one, and it is why `follow` is a generation the UI
// can prompt on rather than something the worker silently assumes.
import { describe, expect, it } from 'vitest'
import {
  spotifyGenerationAtLeast,
  spotifyGrantLacksFollowScope,
  spotifyGrantLacksLibraryScopes,
  spotifyScopeGeneration,
} from './integrations.api'

const PLAYBACK = 'user-read-currently-playing user-read-recently-played user-read-playback-state user-modify-playback-state'
const LIBRARY = `${PLAYBACK} user-library-read user-library-modify`
const FOLLOW = `${LIBRARY} user-follow-read`

describe('spotifyScopeGeneration', () => {
  it('ranks a pre-Step-5 library grant below a follow grant', () => {
    expect(spotifyScopeGeneration(LIBRARY, true)).toBe('library')
    expect(spotifyScopeGeneration(FOLLOW, true)).toBe('follow')
  })

  it('leaves the older generations exactly where they were', () => {
    expect(spotifyScopeGeneration(null, false)).toBe('none')
    expect(spotifyScopeGeneration('user-read-currently-playing', true)).toBe('legacy')
    expect(spotifyScopeGeneration(PLAYBACK, true)).toBe('playback')
  })
})

describe('the two gaps are separate', () => {
  it('reports a follow gap on a grant that has every library scope', () => {
    expect(spotifyGrantLacksLibraryScopes(LIBRARY)).toBe(false)
    expect(spotifyGrantLacksFollowScope(LIBRARY)).toBe(true)
  })

  it('reports no follow gap once the scope is granted', () => {
    expect(spotifyGrantLacksFollowScope(FOLLOW)).toBe(false)
  })

  it('treats an absent scope string as missing, not as granted', () => {
    // Fail closed: an unknown grant must prompt, never be assumed complete.
    expect(spotifyGrantLacksFollowScope(null)).toBe(true)
    expect(spotifyGrantLacksFollowScope(undefined)).toBe(true)
    expect(spotifyGrantLacksFollowScope('')).toBe(true)
  })
})

describe('spotifyGenerationAtLeast', () => {
  it('orders the ladder so a newer grant satisfies an older requirement', () => {
    expect(spotifyGenerationAtLeast('follow', 'library')).toBe(true)
    expect(spotifyGenerationAtLeast('follow', 'playback')).toBe(true)
    expect(spotifyGenerationAtLeast('library', 'playback')).toBe(true)
  })

  it('does not let an older grant satisfy a newer requirement', () => {
    expect(spotifyGenerationAtLeast('library', 'follow')).toBe(false)
    expect(spotifyGenerationAtLeast('playback', 'library')).toBe(false)
    expect(spotifyGenerationAtLeast('none', 'playback')).toBe(false)
  })
})
