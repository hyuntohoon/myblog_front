<!--
  ARCH-entity-interaction-domain-audit — guardrail checklist (RFC "Rule
  ownership and placement"). G3/G5 are mechanically enforced by ESLint; the
  items below are review-only and don't have a machine gate, so they only
  work if actually filled in.
-->

## Summary

<!-- What changed and why. -->

## Test plan

<!-- pnpm lint / astro check / pnpm test output, or why one was skipped. -->

## Entity-interaction guardrail checklist

Skip a line with "n/a" if this PR doesn't touch that surface.

- [ ] **G1** — If this adds a new album/review/memo-shaped action (rating, candidate-mark,
      bucket memo, draft-review, or similar "my relationship to an album" state): which of the
      3 existing commands (`album_reviews` PUT, `review_bucket_items` PATCH, `posts` POST/PUT)
      does it extend, or why does it justify a 4th? See `component-map.md`'s "State-owner
      registry".
- [ ] **G7** — If this adds a new overlay, `CustomEvent`, command, or state owner: which
      `docs/frontend/component-map.md` (myblog-workspace repo) registry entry did you check
      before adding it, and what did you update there?
- [ ] **G8** — If this changes an overlay, drag source, or add-to-bucket flow: which
      component-level (render+interaction) test covers it?
