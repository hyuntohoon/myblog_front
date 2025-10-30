/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [
		'./src/**/*.{astro,html,js,jsx,ts,tsx,mdx}', // astro 컴포넌트 포함
	],
	theme: {
		extend: {},
	},
	plugins: [require('daisyui')],
	daisyui: {
		themes: ['light'], // 필요시 ["corporate"], ["dark"], 등으로 교체 가능
	},
}
