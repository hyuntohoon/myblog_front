// src/scripts/spotify-callback.client.ts — FEAT-multi-user 3b-e.
// Relay the Spotify authorize callback: verify the CSRF state, PUT the
// one-time ?code to the backend (server-side exchange, 3b-c), return to
// /settings/. The code is single-use — on any failure the member restarts
// from the settings connect button, never by reloading this page.
import { connectSpotify, consumeSpotifyState, SpotifyConnectError } from '../components/member/integrations.api'
import { isLoggedIn } from '../lib/auth'

function show(msg: string, failed = false) {
	const el = document.getElementById('msg')
	if (el)
		el.textContent = msg
	if (failed) {
		document.getElementById('spinner')?.classList.add('hidden')
		document.getElementById('back')?.classList.remove('hidden')
	}
}

function connectFailureMessage(e: unknown): string {
	if (e instanceof SpotifyConnectError) {
		if (e.status === 400)
			return '인증 코드가 만료됐어요. 설정에서 다시 연결해 주세요.'
		if (e.status === 503)
			return '아직 연결을 받을 준비가 안 됐어요. 잠시 후 설정에서 다시 시도해 주세요.'
	}
	return '연결하지 못했어요. 설정에서 다시 시도해 주세요.'
}

async function run() {
	const qs = new URLSearchParams(location.search)

	if (qs.get('error')) {
		// access_denied = the member pressed cancel on Spotify's consent page.
		show(qs.get('error') === 'access_denied' ? '연결을 취소했어요.' : '연결하지 못했어요. 설정에서 다시 시도해 주세요.', true)
		return
	}

	const code = qs.get('code')
	if (!code) {
		show('연결 코드가 없어요. 설정에서 다시 시도해 주세요.', true)
		return
	}
	if (!consumeSpotifyState(qs.get('state'))) {
		show('연결 요청을 확인하지 못했어요. 설정에서 다시 시도해 주세요.', true)
		return
	}
	if (!isLoggedIn()) {
		show('로그인이 풀렸어요. 설정에서 로그인 후 다시 연결해 주세요.', true)
		return
	}

	show('Spotify 연결 중…')
	try {
		await connectSpotify(code)
	}
	catch (e) {
		console.error(e)
		show(connectFailureMessage(e), true)
		return
	}
	show('연결됐어요. 설정으로 돌아갑니다…')
	location.replace('/settings/')
}

document.getElementById('back')?.addEventListener('click', () => location.replace('/settings/'))
run()
