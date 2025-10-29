// UI 관련(토스트, 폼 바인딩, 카테고리/리뷰 토글, 앨범 미리보기)
import { fetchCategories, createCategory } from './api'

export function showToast(
	message: string,
	variant: 'success' | 'error' = 'error',
	ms = 2600
) {
	let host = document.getElementById('toast-host')
	if (!host) {
		host = document.createElement('div')
		host.id = 'toast-host'
		host.style.position = 'fixed'
		host.style.left = '50%'
		host.style.bottom = '24px'
		host.style.transform = 'translateX(-50%)'
		host.style.zIndex = '9999'
		host.style.display = 'flex'
		host.style.flexDirection = 'column'
		host.style.gap = '10px'
		document.body.appendChild(host)
	}
	const el = document.createElement('div')
	el.textContent = message
	el.style.padding = '12px 14px'
	el.style.borderRadius = '10px'
	el.style.fontSize = '14px'
	el.style.color = variant === 'success' ? '#073b16' : '#5a0b0b'
	el.style.background = variant === 'success' ? '#c9f7d9' : '#ffd8d6'
	el.style.boxShadow = '0 6px 24px rgba(0,0,0,.12)'
	el.style.minWidth = '240px'
	el.style.textAlign = 'center'
	host.appendChild(el)
	setTimeout(() => {
		el.style.transition = 'opacity .25s ease'
		el.style.opacity = '0'
		setTimeout(() => el.remove(), 260)
	}, ms)
}

export function redirectOnSuccess(slug?: string) {
	const refOk =
		document.referrer &&
		(() => {
			try {
				const u = new URL(document.referrer)
				return u.origin === location.origin
			} catch {
				return false
			}
		})()
	if (refOk) {
		showToast('✅ 저장 & 발행 완료! 이전 페이지로 이동합니다.', 'success', 1400)
		setTimeout(() => history.back(), 1200)
		return
	}
	const target = slug ? `/posts/${slug}/` : '/'
	showToast('✅ 저장 & 발행 완료!', 'success', 1200)
	setTimeout(() => location.assign(target), 900)
}

export async function loadCategoriesToSelect(
	sel: HTMLSelectElement,
	helpEl?: HTMLElement
) {
	try {
		const items = await fetchCategories()
		sel.innerHTML = ''
		if (!items.length) {
			if (helpEl) helpEl.classList.remove('hidden')
			sel.innerHTML = '<option value="">(no categories)</option>'
			sel.value = ''
			return
		}
		if (helpEl) helpEl.classList.add('hidden')
		const frag = document.createDocumentFragment()
		const placeholder = document.createElement('option')
		placeholder.value = ''
		placeholder.textContent = 'Select category...'
		placeholder.disabled = true
		placeholder.selected = true
		frag.appendChild(placeholder)
		for (const c of items) {
			const opt = document.createElement('option')
			opt.value = String((c as any).id ?? (c as any).value ?? c)
			opt.textContent = (c as any).name ?? (c as any).label ?? String(c)
			frag.appendChild(opt)
		}
		sel.appendChild(frag)
	} catch {
		sel.innerHTML = '<option value="">(failed to load categories)</option>'
		sel.value = ''
		if (helpEl) helpEl.classList.remove('hidden')
	}
}

export function wireCategoryAddButton(
	btn: HTMLButtonElement,
	sel: HTMLSelectElement,
	helpEl?: HTMLElement
) {
	const onClick = async () => {
		const name = prompt('새 카테고리 이름을 입력하세요:')
		if (!name) return
		const trimmed = name.trim()
		if (!trimmed) return
		try {
			const saved = await createCategory(trimmed)
			const opt = document.createElement('option')
			opt.value = saved?.id ? String(saved.id) : trimmed
			opt.textContent = saved?.name ?? trimmed
			sel.appendChild(opt)
			sel.value = opt.value
			if (helpEl) helpEl.classList.add('hidden')
		} catch {
			showToast('카테고리 생성 실패', 'error')
		}
	}
	btn.removeEventListener('click', onClick)
	btn.addEventListener('click', onClick)
}

export function wireReviewToggle(chk: HTMLInputElement, section: HTMLElement) {
	const onChange = () => section.classList.toggle('hidden', !chk.checked)
	chk.removeEventListener('change', onChange)
	chk.addEventListener('change', onChange)
}

export function wireAlbumPreview(
	sel: HTMLSelectElement,
	previewWrap: HTMLElement,
	imgEl: HTMLImageElement | null
) {
	const albumImages: Record<string, string> = {
		1: 'https://i.scdn.co/image/ab67616d0000b273f3f8ed949a4f79f5ad5caa7c',
		2: 'https://i.scdn.co/image/ab67616d0000b273a9a5fd746f62bcee3e6a9db7',
		3: 'https://i.scdn.co/image/ab67616d0000b273620e42f6a19cfb459dbf5566',
	}
	const onAlbumChange = () => {
		const id = sel.value
		if (id && albumImages[id]) {
			previewWrap.classList.remove('hidden')
			if (imgEl) imgEl.src = albumImages[id]
		} else {
			previewWrap.classList.add('hidden')
		}
	}
	sel.removeEventListener('change', onAlbumChange)
	sel.addEventListener('change', onAlbumChange)
}
