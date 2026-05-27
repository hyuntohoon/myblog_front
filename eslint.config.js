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
		ignores: ['**/dist/**', '**/.astro/**', 'node_modules/**', 'src/**/*.gen.ts'],
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
)
