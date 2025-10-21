// eslint.config.js 또는 .eslintrc.cjs (지금 쓰는 파일 그대로 대체)
import antfu from '@antfu/eslint-config'

export default antfu(
	{
		// 🔧 포매팅 의도 (탭, 싱글쿼트, 세미콜론 X)
		stylistic: {
			indent: 'tab',
			quotes: 'single',
			semi: false,
		},
		perfectionist: false,

		// ❗ antfu가 기본으로 켜는 eslint-plugin-format 비활성화
		// (이게 "Replace `··` with `↹` eslint(format/prettier)"의 주원인)
		formatters: false,

		// 프로젝트 옵션
		astro: true,
		typescript: true,
	},

	// 추가 오버라이드 (룰/무시 경로)
	{
		rules: {
			// 포맷은 Prettier가 담당 → 스타일/포맷 관련 룰 꺼서 충돌 방지
			'no-mixed-spaces-and-tabs': 'off', // 일단 끄고 일괄 변환 후 필요하면 'error'로 되돌리세요
			'quote-props': 'off',
			'style/quote-props': 'off', // eslint-stylistic 네임스페이스용
			'style/indent': 'off',
			'style/no-multi-spaces': 'off',
			'perfectionist/sort-imports': 'off',
		},
		ignores: ['**/dist/**', '**/.astro/**', 'node_modules/**'],
	}
)
