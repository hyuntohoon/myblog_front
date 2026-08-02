// FEAT-member-player Step 5 — keep in-page audio alive across ClientRouter navigations.
//
// WHY THIS FILE EXISTS, measured on prod 2026-08-02 (RFC OQ4):
//
// The Web Playback SDK appends its own audio-bearing iframe straight to <body>.
// Astro's default swap does `oldBody.replaceWith(newBody)`, so that iframe is torn
// out on every navigation and the sound stops.
//
// `transition:persist` does NOT fix it, twice over:
//   - persist matches an element against a counterpart in the INCOMING document; a
//     runtime-injected node has none, so it is dropped outright.
//   - even inside a genuinely persisted island the iframe RELOADED — the host node
//     survived as the same object, the iframe inside it did not.
// Root cause is not Astro-specific: `swapBodyElement` re-inserts (`replaceWith`
// twice), and re-inserting an iframe destroys its browsing context per spec. Astro
// guarantees *node identity*; audio needs *browsing-context continuity*. Different
// guarantees.
//
// So the body step is replaced with one that MUTATES <body> in place and never
// detaches the audio host. Everything else — script de-duplication, head diffing,
// root attributes, focus — stays Astro's own: a hand-rolled head swap re-executes
// page scripts, which is a real regression and not worth re-deriving.
import { swapFunctions } from 'astro:transitions/client'

const PERSIST_ATTR = 'data-astro-transition-persist'

/**
 * Nodes that must never be detached. The SDK's iframe is matched by src because we
 * do not create it and cannot tag it before it exists; the marker attribute covers
 * anything we mount ourselves later.
 *
 * CONSTRAINT, deliberate: only **direct children of `<body>`** are protected — which
 * is exactly where the SDK puts its iframe. Protecting a nested one would mean
 * hoisting it out and back, and a move is itself a re-insertion, i.e. the very thing
 * this file exists to avoid. A nested audio host would be silently unprotected, so
 * `assertAudioHostsProtected` below fails loudly in dev instead.
 */
const AUDIO_HOST = 'iframe[src*="sdk.scdn.co"], [data-playback-audio-host]'

/**
 * Astro's `swapBodyElement`, with one change: the live `<body>` element is kept and
 * its children are mutated, instead of the element being replaced.
 *
 * Everything else is a faithful copy of upstream (`swap-functions.js`) — persisted-id
 * matching, the `astro-island` props copy with its `shouldCopyProps` / `isSameProps`
 * conditions, and `attachShadowRoots`. Copied rather than simplified on purpose: the
 * props-copy default is `true` (it is opt-*out* via `data-astro-transition-persist-props`),
 * so "this site does not need it" was an assumption worth not making.
 *
 * Persisted islands are still re-inserted here, exactly as upstream re-inserts them.
 * That is safe for React state (which lives in JS, not the DOM) and is unchanged
 * behavior — but it does mean an iframe nested inside a persisted island would still
 * reload. Only the body-level audio hosts get the stronger guarantee.
 */
function swapBodyPreservingAudio(newBody: HTMLElement, oldBody: HTMLElement): void {
  const keepers = Array.from(oldBody.children).filter(el => el.matches(AUDIO_HOST))

  for (const el of Array.from(oldBody.querySelectorAll(`[${PERSIST_ATTR}]`))) {
    const id = el.getAttribute(PERSIST_ATTR)
    const newEl = newBody.querySelector(`[${PERSIST_ATTR}="${id}"]`)
    if (!newEl)
      continue
    newEl.replaceWith(el)
    const persistProps = (el as HTMLElement).dataset.astroTransitionPersistProps
    const shouldCopyProps = persistProps == null || persistProps === 'false'
    const newProps = newEl.getAttribute('props')
    if (newEl.localName === 'astro-island' && shouldCopyProps && el.getAttribute('props') !== newProps) {
      el.setAttribute('ssr', '')
      if (newProps != null)
        el.setAttribute('props', newProps)
    }
  }

  for (const child of Array.from(oldBody.children)) {
    if (!keepers.includes(child))
      child.remove()
  }
  const anchor = keepers[0] ?? null
  for (const child of Array.from(newBody.children))
    oldBody.insertBefore(child, anchor)

  // Body attributes come from the incoming document (page-specific classes etc.).
  for (const attr of Array.from(oldBody.attributes)) {
    if (!newBody.hasAttribute(attr.name))
      oldBody.removeAttribute(attr.name)
  }
  for (const attr of Array.from(newBody.attributes))
    oldBody.setAttribute(attr.name, attr.value)

  attachShadowRoots(oldBody)
}

/** Upstream's `attachShadowRoots`, applied to the live body after the swap. */
function attachShadowRoots(root: HTMLElement): void {
  root.querySelectorAll('template[shadowrootmode]').forEach((template) => {
    const mode = template.getAttribute('shadowrootmode')
    const parent = template.parentNode
    if ((mode === 'closed' || mode === 'open') && parent instanceof HTMLElement) {
      if (parent.shadowRoot) {
        template.remove()
        return
      }
      const shadowRoot = parent.attachShadow({ mode })
      shadowRoot.appendChild((template as HTMLTemplateElement).content)
    }
  })
}

/**
 * Install the override. Idempotent — `layout.astro` renders this script once, but a
 * full page load after a client-side navigation would otherwise stack listeners.
 */
export function installPlaybackPersist(): void {
  const w = window as Window & { __playbackPersistInstalled?: boolean }
  if (w.__playbackPersistInstalled)
    return
  w.__playbackPersistInstalled = true

  document.addEventListener('astro:before-swap', (event) => {
    const e = event as Event & { newDocument: Document, swap: () => void }
    // Nothing to protect → leave Astro's default swap entirely alone, so the common
    // case (no audio in this tab) keeps stock behavior and stock risk. This is the
    // whole reason the override is safe to ship site-wide: it is inert until the
    // owner actually plays in-page.
    if (!document.body.querySelector(AUDIO_HOST))
      return

    assertAudioHostsProtected()

    e.swap = () => {
      const doc = e.newDocument
      swapFunctions.deselectScripts(doc)
      swapFunctions.swapRootAttributes(doc)
      swapFunctions.swapHeadElements(doc)
      const restoreFocus = swapFunctions.saveFocus()
      swapBodyPreservingAudio(doc.body, document.body)
      restoreFocus()
    }
  })
}

/**
 * An audio host that is not a direct child of `<body>` gets no protection and its
 * sound would stop — silently, and only on navigation, which is the worst way to
 * find out. Say so in dev rather than shipping a quiet gap.
 */
function assertAudioHostsProtected(): void {
  if (!import.meta.env.DEV)
    return
  const nested = Array.from(document.body.querySelectorAll(AUDIO_HOST))
    .filter(el => el.parentElement !== document.body)
  if (nested.length) {
    console.warn(
      '[playbackPersist] audio host is not a direct child of <body>; it will be re-inserted and its sound will stop on navigation:',
      nested,
    )
  }
}
