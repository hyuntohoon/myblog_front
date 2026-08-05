import antfu from '@antfu/eslint-config'
import unusedImports from 'eslint-plugin-unused-imports'

export default antfu(
	{
		stylistic: {
			indent: 'tab',
			quotes: 'single',
			semi: false,
		},
		perfectionist: false,
		formatters: false,
		astro: true,
		typescript: true,
		ignores: ['**/dist/**', '**/.astro/**', 'node_modules/**', 'src/**/*.gen.ts', '_workspace/**'],
	},

	{
		plugins: { 'unused-imports': unusedImports },
		rules: {
			'style/operator-linebreak': ['error', 'after'],
			'no-mixed-spaces-and-tabs': 'off',
			'quote-props': 'off',
			'style/quote-props': 'off',
			'style/indent': 'off',
			'style/no-multi-spaces': 'off',
			'perfectionist/sort-imports': 'off',
			'unused-imports/no-unused-imports': 'error',
		},
	},

	// ARCH-entity-interaction-domain-audit G3 + G5 mechanical guardrails, split
	// into three non-overlapping blocks (review finding, 2026-08-05: the prior
	// single-block form shared one `ignores` list for both selectors, so
	// `ignores` — which exempts a matching file from EVERY rule in that config
	// object, not per-selector — accidentally exempted lib/buckets.ts from G3
	// too, and entityEvents.ts/pocketBuckit/events.ts/albumDetail.fetch.client.ts
	// from G5 too). Flat config REPLACES, not merges, an array-valued rule when
	// two config objects both match the same file — so the fix is not "two
	// blocks with their own ignores" (any file matching both would silently
	// drop one selector's block entirely); it's keeping each rule-setting block
	// mutually exclusive by `files`, so every file matches exactly one of the
	// three below.
	//
	// G3: every app CustomEvent name is declared in lib/entityEvents.ts or
	// lib/pocketBuckit/events.ts and dispatched via the imported constant — no
	// inline string literal elsewhere. (The declaration files themselves are
	// where the literal legitimately lives; albumDetail.fetch.client.ts's
	// `album:detail` is a documented exception — a permanent module-scope
	// vanilla listener, not the drift pattern this guards.)
	//
	// G5: the spotify_library exclusion rule has exactly one owner
	// (isManualAddTarget/SLIB_KIND in lib/buckets.ts) — no other file hardcodes
	// the string literal.
	{
		// G3's own exemption — legitimately needs the CustomEvent literal, but is
		// not G5's owner, so G5 still applies here.
		files: [
			'src/lib/entityEvents.ts',
			'src/lib/pocketBuckit/events.ts',
			'src/scripts/albumDetail.fetch.client.ts',
		],
		rules: {
			'no-restricted-syntax': [
				'error',
				{ selector: 'Literal[value=\'spotify_library\']', message: 'spotify_library is owned by lib/buckets.ts (isManualAddTarget/SLIB_KIND) — no other file may hardcode this string literal (ARCH-entity-interaction-domain-audit G5).' },
			],
		},
	},
	{
		// G5's own exemption — legitimately needs the string literal, but is not
		// a G3 exemption, so G3 still applies here.
		files: ['src/lib/buckets.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{ selector: 'NewExpression[callee.name=\'CustomEvent\'] > Literal.arguments:first-child', message: 'Declare the event name in lib/entityEvents.ts or lib/pocketBuckit/events.ts and dispatch via the imported constant, not an inline string literal (ARCH-entity-interaction-domain-audit G3).' },
			],
		},
	},
	{
		// Everyone else: both selectors apply.
		files: ['src/**/*.{ts,tsx,astro}'],
		ignores: [
			'src/lib/entityEvents.ts',
			'src/lib/pocketBuckit/events.ts',
			'src/scripts/albumDetail.fetch.client.ts',
			'src/lib/buckets.ts',
		],
		rules: {
			'no-restricted-syntax': [
				'error',
				{ selector: 'NewExpression[callee.name=\'CustomEvent\'] > Literal.arguments:first-child', message: 'Declare the event name in lib/entityEvents.ts or lib/pocketBuckit/events.ts and dispatch via the imported constant, not an inline string literal (ARCH-entity-interaction-domain-audit G3).' },
				{ selector: 'Literal[value=\'spotify_library\']', message: 'spotify_library is owned by lib/buckets.ts (isManualAddTarget/SLIB_KIND) — no other file may hardcode this string literal (ARCH-entity-interaction-domain-audit G5).' },
			],
		},
	},
)
