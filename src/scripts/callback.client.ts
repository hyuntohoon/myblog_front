// src/scripts/callback.client.ts
import { consumeReturnTo, goLogin, handleCallback } from '../lib/auth'

function log(m: string) {
	console.log(m)
	const el = document.getElementById('msg')
	if (el)
el.textContent = m
}

async function run() {
	try {
		log('🔄 콜백 처리 시작…')

		const qs = new URLSearchParams(location.search)
		const code = qs.get('code')
		const state = qs.get('state')
		const verifier = sessionStorage.getItem('pkce_verifier')
		const savedState = sessionStorage.getItem('oauth_state')

		if (!code) {
			log('❌ code 없음. 다시 로그인합니다…')
			await goLogin(true)
			return
		}
		if (!verifier || !savedState || savedState !== state) {
			log('⚠️ 세션 만료/새 탭 문제. 다시 로그인합니다…')
			await goLogin(true)
			return
		}

		log('🔑 토큰 교환 중…')
		await handleCallback()

		log('✅ 로그인 완료. 이동합니다…')
		// 로그인 직전 페이지로 복귀(goLogin이 캡처, consumeReturnTo가 1회성
		// 소비+경로 검증). 캡처가 없으면 홈 — 무조건 홈은 원래 의도(평가하려던
		// 앨범 등)를 잃는다(audit 2026-07-14).
		location.replace(consumeReturnTo())
	}
 catch (e: any) {
		console.error(e)
		log(`❌ 로그인 처리 실패: ${e?.message ?? String(e)}`)
		document.getElementById('retry')?.classList.remove('hidden')
	}
}

document.getElementById('retry')?.addEventListener('click', () => goLogin(true))
run()
