// ✅ Toast UI Editor (Markdown 기반 WYSIWYG)
import '@toast-ui/editor/dist/toastui-editor.css'
import { Editor } from '@toast-ui/editor'

let editor: Editor | null = null

export function initEditor(selector = '#editor') {
	const el = document.querySelector(selector)
	if (!el) {
		console.warn('Editor container not found:', selector)
		return null
	}

	// 이미 초기화된 경우 재사용
	if (editor) return editor

	editor = new Editor({
		el,
		height: '500px',
		initialEditType: 'markdown',
		previewStyle: 'vertical', // 좌:에디터 / 우:미리보기
		usageStatistics: false,
		hideModeSwitch: false,
		placeholder: '# Heading\n\nWrite here...',
		toolbarItems: [
			['heading', 'bold', 'quote'],
			['ol', 'indent', 'outdent'],
			['scrollSync'],
		],
	})

	return editor
}

export function getContent(): string {
	return editor ? editor.getMarkdown() : ''
}

export function setContent(value: string) {
	if (editor) editor.setMarkdown(value)
}

export function resetContent() {
	if (editor) editor.setMarkdown('')
}

export function isReady() {
	return !!editor
}
