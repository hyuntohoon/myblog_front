import { describe, expect, it } from 'vitest'
import { FOOTER_BROWSE, HEADER_NAV, visibleLinks } from './siteNav'

describe('visibleLinks (FEAT-public-surfaces-before-first-review Step 1)', () => {
  it('hides Reviews, Best New Music and Canon while there are 0 평론', () => {
    expect(visibleLinks(HEADER_NAV, 0).map(l => l.url)).toEqual(['/genres', '/releases', '/collection'])
    expect(visibleLinks(FOOTER_BROWSE, 0).map(l => l.href)).toEqual(['/genres', '/releases', '/collection'])
  })

  it('keeps today\'s full nav once the first 평론 exists', () => {
    expect(visibleLinks(HEADER_NAV, 1).map(l => l.url)).toEqual([
      '/reviews',
      '/genres',
      '/releases',
      '/reviews?bnm=1',
      '/canon',
      '/collection',
    ])
    expect(visibleLinks(FOOTER_BROWSE, 1).map(l => l.href)).toEqual(['/reviews', '/genres', '/releases', '/canon', '/collection'])
  })
})
