// src/scripts/header.client.ts
import { isLoggedIn, goLogin, logout } from '../lib/auth.ts'

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null
const loginBtn = $('#login-btn')
const logoutBtn = $('#logout-btn')
const writeLink = $('#write-link')

function syncAuthUI() {
	const logged = isLoggedIn()
	if (logged) {
		loginBtn?.classList.add('hidden')
		logoutBtn?.classList.remove('hidden')
		writeLink?.classList.remove('hidden')
	} else {
		loginBtn?.classList.remove('hidden')
		logoutBtn?.classList.add('hidden')
		writeLink?.classList.add('hidden')
	}
}

// 초기 동기화
syncAuthUI()

// 이벤트 바인딩
loginBtn?.addEventListener('click', () => {
	// 로그인 후 현재 페이지로 복귀
	goLogin(false, location.pathname + location.search + location.hash)
})
logoutBtn?.addEventListener('click', () => logout())

// (선택) 히스토리 이동 시에도 상태 반영하고 싶다면:
window.addEventListener('popstate', syncAuthUI)
