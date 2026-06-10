// src/lib/auth.ts
// 환경변수 (.env.*)
// PUBLIC_COGNITO_DOMAIN=ap-northeast-254vejkeu5.auth.ap-northeast-2.amazoncognito.com
// PUBLIC_COGNITO_CLIENT_ID=68ccmcanfbvla9qbovnb9b18bt
// PUBLIC_COGNITO_REDIRECT_URI=http://localhost:4321/admin/callback   // trailingSlash: 'never' 기준 (슬래시 없음)

const COGNITO_DOMAIN = import.meta.env.PUBLIC_COGNITO_DOMAIN as string
const CLIENT_ID = import.meta.env.PUBLIC_COGNITO_CLIENT_ID as string
const REDIRECT_URI = import.meta.env.PUBLIC_COGNITO_REDIRECT_URI as string // 콜백 URL (콘솔 등록값과 100% 동일)
const SCOPES = 'openid email profile'

// ───────────────────────────── PKCE ─────────────────────────────
function b64url(bytes: Uint8Array) {
	// 32바이트만 다룸(OK). 브라우저에서 안전.
	let str = ''
	for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
async function sha256(input: Uint8Array) {
	const digest = await crypto.subtle.digest('SHA-256', input as any)
	return new Uint8Array(digest)
}
async function makePkce() {
	const rand = crypto.getRandomValues(new Uint8Array(32))
	const verifier = b64url(rand)
	const challenge = b64url(await sha256(new TextEncoder().encode(verifier)))
	return { verifier, challenge }
}

// ───────────────────────── Storage Keys ─────────────────────────
const LS_ACCESS = 'access_token'
const LS_ID = 'id_token'
const LS_REFRESH = 'refresh_token'
const SS_VERIFIER = 'pkce_verifier'
const SS_STATE = 'oauth_state'

// ─────────────────────────── Helpers ────────────────────────────

/**
 * Local-dev bypass. Backend and music services both bypass Cognito JWT
 * validation when `ENV=local`/`dev` (app/core/auth.py). To match that,
 * the frontend pretends the user is logged in whenever the page is
 * served from localhost — `apiFetch` will still send a Bearer header
 * (with a dummy token), and the server accepts it.
 *
 * In prod (any non-localhost host), tokens come from Cognito as normal.
 */
function isLocalEnv(): boolean {
	if (typeof location === 'undefined')
		return false
	const h = location.hostname
	return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')
}

const LOCAL_DEV_TOKEN = 'local-dev'

export function getAccessToken(): string | null {
	if (isLocalEnv())
		return LOCAL_DEV_TOKEN
	return localStorage.getItem(LS_ACCESS)
}
export function isLoggedIn(): boolean {
	if (isLocalEnv())
		return true
	return !!localStorage.getItem(LS_ACCESS)
}
export function getAuthHeader(): Record<string, string> {
	const t = getAccessToken()
	return t ? { Authorization: `Bearer ${t}` } : {}
}

// ─────────────────────── Login / Logout ─────────────────────────
/**
 * 로그인 시작. 로그인 완료 후에는 항상 홈(`/`)으로 이동한다(콜백 처리에서 결정).
 * @param force true이면 매번 로그인 폼 강제(prompt=login)
 */
export async function goLogin(force: boolean = false) {
	// ENV guard
	if (COGNITO_DOMAIN.includes('/')) {
		console.error(
			'[auth] PUBLIC_COGNITO_DOMAIN should not contain a path:',
			COGNITO_DOMAIN,
		)
	}

	const { verifier, challenge } = await makePkce()
	sessionStorage.setItem(SS_VERIFIER, verifier)

	const state = crypto.randomUUID()
	sessionStorage.setItem(SS_STATE, state)

	const url = new URL(`https://${COGNITO_DOMAIN}/oauth2/authorize`)
	const params: Record<string, string> = {
		client_id: CLIENT_ID,
		response_type: 'code',
		scope: SCOPES,
		redirect_uri: REDIRECT_URI, // 콘솔 Callback URL과 100% 동일(슬래시 유무까지)
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state,
	}
	if (force)
params.prompt = 'login'
	url.search = new URLSearchParams(params).toString()

	location.assign(url.toString())
}

/**
 * 콜백 처리: code → 토큰 교환 및 저장. 이동은 호출부(callback.client.ts)가
 * 담당한다(로그인 후 항상 홈으로).
 */
export async function handleCallback() {
	const qs = new URLSearchParams(location.search)
	const code = qs.get('code')
	const state = qs.get('state')
	const savedState = sessionStorage.getItem(SS_STATE)
	if (!code || !state || state !== savedState) {
		throw new Error('Invalid OAuth state or missing code')
	}

	const verifier = sessionStorage.getItem(SS_VERIFIER)
	if (!verifier) {
		throw new Error('Missing PKCE verifier')
	}

	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: CLIENT_ID,
		code,
		redirect_uri: REDIRECT_URI, // 로그인 시작 때와 동일해야 함
		code_verifier: verifier,
	})

	const tokenEndpoint = `https://${COGNITO_DOMAIN}/oauth2/token`
	const resp = await fetch(tokenEndpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	})
	if (!resp.ok) {
		// 디버깅을 위해 본문 노출
		throw new Error(
			`Token exchange failed: ${resp.status} ${await resp.text()}`,
		)
	}
	const json = await resp.json()

	localStorage.setItem(LS_ACCESS, json.access_token || '')
	if (json.id_token)
localStorage.setItem(LS_ID, json.id_token)
	if (json.refresh_token)
localStorage.setItem(LS_REFRESH, json.refresh_token)

	// cleanup
	sessionStorage.removeItem(SS_VERIFIER)
	sessionStorage.removeItem(SS_STATE)
}

/**
 * Cognito access tokens have a 60-min TTL. Refresh tokens last 5 days.
 * Call this when an authed request returns 401: it exchanges the stored
 * refresh_token for a new access_token. Returns the new token on success,
 * null on failure (caller should goLogin() in that case).
 */
export async function refreshAccessToken(): Promise<string | null> {
	const refresh = localStorage.getItem(LS_REFRESH)
	if (!refresh)
		return null

	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: CLIENT_ID,
		refresh_token: refresh,
	})

	try {
		const resp = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		})
		if (!resp.ok)
			return null
		const json = await resp.json() as { access_token?: string, id_token?: string }
		if (!json.access_token)
			return null
		localStorage.setItem(LS_ACCESS, json.access_token)
		if (json.id_token)
			localStorage.setItem(LS_ID, json.id_token)
		// Cognito does not rotate the refresh_token by default; keep the stored one.
		return json.access_token
	}
	catch {
		return null
	}
}

export function logout() {
	localStorage.removeItem(LS_ACCESS)
	localStorage.removeItem(LS_ID)
	localStorage.removeItem(LS_REFRESH)

	// 로그인 UI를 통한 완전 로그아웃
	const logoutUri = new URL(REDIRECT_URI).origin // 로그아웃 후 보여줄 페이지
	const u = new URL(`https://${COGNITO_DOMAIN}/logout`)
	u.search = new URLSearchParams({
		client_id: CLIENT_ID,
		logout_uri: logoutUri,
	}).toString()
	location.assign(u.toString())
}

// ─────────────────────── fetch 래퍼 ────────────────────────────
export async function authFetch(url: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers || {})
	if (!headers.has('Content-Type'))
		headers.set('Content-Type', 'application/json')

	const token = getAccessToken()
	if (token)
headers.set('Authorization', `Bearer ${token}`)

	return fetch(url, { ...init, headers })
}
