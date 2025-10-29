// EasyMDE만 담당: 생성, 값 읽기/초기화, 재초기화 방지
import EasyMDE from 'easymde'
import 'easymde/dist/easymde.min.css'
import type { Options } from 'easymde'

let mde: EasyMDE | null = null
let boundEl: HTMLTextAreaElement | null = null

const defaultOptions: Partial<Options> = {
	spellChecker: false,
	forceSync: true,
	minHeight: '420px',
	autosave: {
		enabled: true,
		uniqueId: 'write-page-draft',
		delay: 1000,
		submit_delay: 4000,
		text: 'Autosaved: ',
	},
	placeholder: '# Heading\n\nWrite here...',
	insertTexts: {
		link: ['[', '](https://)'],
		image: ['![](', ')'],
		table: [
			'',
			'\n\n| Column 1 | Column 2 |\n| -------- | -------- |\n| Text     | Text     |\n\n',
		],
		horizontalRule: ['', '\n\n-----\n\n'],
	},
	renderingConfig: {
		singleLineBreaks: false,
		codeSyntaxHighlighting: true, // highlight.js CSS 별도 로드 필요
	},
	status: ['autosave', 'lines', 'words', 'cursor'],
	toolbar: [
		'undo',
		'redo',
		'|',
		'bold',
		'italic',
		'strikethrough',
		'code',
		'|',
		{
			name: 'heading',
			action: EasyMDE.toggleHeadingSmaller,
			className: 'fa fa-header',
			title: 'Headers',
		},
		'|',
		'quote',
		'unordered-list',
		'ordered-list',
		'table',
		'horizontal-rule',
		'|',
		'link',
		'image',
		'|',
		'preview',
		'side-by-side',
		'fullscreen',
		'|',
		'guide',
	],
	toolbarTips: true,
}

export function initEditor(
	textareaSelector = 'textarea[name="content"]',
	opts?: Partial<Options>
) {
	const el = document.querySelector(
		textareaSelector
	) as HTMLTextAreaElement | null
	if (!el) return null
	if (mde && boundEl === el) return mde // 중복 초기화 방지

	mde = new EasyMDE({ element: el, ...defaultOptions, ...(opts || {}) })
	boundEl = el
	return mde
}

export function getContent(): string {
	return mde ? mde.value() : (boundEl?.value ?? '')
}

export function setContent(v: string) {
	if (mde) mde.value(v)
	else if (boundEl) boundEl.value = v
}

export function resetContent() {
	setContent('')
}

export function isReady() {
	return !!mde
}
