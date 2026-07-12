// /settings root island (FEAT-multi-user-accounts 0e). Three quiet panels in
// the member editorial system: 프로필 (handle + 표시 이름 → PATCH /api/me),
// 연동 (Last.fm 3a + Spotify 3b), 계정 삭제 (the one deliberate accent moment —
// the member signs their own @handle to confirm, 개인정보보호법 deletion).
// Signup entry is NOT here — it opens with 0c (Cognito self-signup + IdPs).
import type { Me } from './me.api'
import { useEffect, useMemo, useState } from 'react'
import { logout } from '@lib/auth'
import { deleteMe, getMe, HANDLE_RE, HandleTakenError, OwnerUndeletableError, updateMe } from './me.api'
import { buildSpotifyAuthorizeUrl, connectLastfm, disconnectLastfm, disconnectSpotify, getIntegrations, spotifyConnectAvailable } from './integrations.api'
import type { Integration } from './integrations.api'
import { SectionTitle } from './ui'

const FIELD_STYLE: React.CSSProperties = {
	width: '100%',
	boxSizing: 'border-box',
	padding: '10px 12px',
	fontSize: 14,
	color: 'var(--color-text)',
	background: 'var(--color-bg)',
	border: '1px solid var(--color-border)',
	borderRadius: 'var(--radius-sm)',
	outline: 'none',
}

function Field({ label, hint, children }: { label: string, hint?: string, children: React.ReactNode }) {
	return (
		<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
			<span className="kicker">{label}</span>
			{children}
			{hint && <span className="meta" style={{ textTransform: 'none', letterSpacing: '0.02em' }}>{hint}</span>}
		</label>
	)
}

// FEAT-multi-user Phase 3a — Last.fm connect (username only, no OAuth). The worker
// poll validates the handle on its first run (status → 'error' if not found).
// The integrations fetch is lifted to IntegrationsPanel (one GET for all providers).
function LastfmConnect({ initial }: { initial: Integration | null }) {
	const [conn, setConn] = useState<Integration | null>(initial)
	const [username, setUsername] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onConnect() {
		const u = username.trim()
		if (!u || busy)
			return
		setBusy(true)
		setError(null)
		const row = await connectLastfm(u)
		setBusy(false)
		if (!row) {
			setError('연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
			return
		}
		setConn(row)
		setUsername('')
	}

	async function onDisconnect() {
		if (busy)
			return
		setBusy(true)
		setError(null)
		const ok = await disconnectLastfm()
		setBusy(false)
		if (!ok) {
			setError('해제하지 못했어요. 잠시 후 다시 시도해 주세요.')
			return
		}
		setConn(null)
	}

	if (conn) {
		const isError = conn.status === 'error'
		const statusLabel = isError ?
			'사용자를 찾지 못했어요 — 이름을 확인하고 다시 연결해 주세요' :
			conn.status === 'connected' ? '연결됨' : conn.status
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
					<span className="kicker">Last.fm</span>
					<span className="mono" style={{ fontSize: 14 }}>{conn.username}</span>
					<span className="meta" style={{ textTransform: 'none', color: isError ? 'var(--color-accent)' : 'var(--color-subtle)' }}>{`· ${statusLabel}`}</span>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
					{error && <span className="meta" role="alert" style={{ color: 'var(--color-accent)', textTransform: 'none' }}>{error}</span>}
					<button type="button" className="btn" disabled={busy} onClick={onDisconnect}>{busy ? '해제 중…' : '연결 해제'}</button>
				</div>
			</div>
		)
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<p className="sans" style={{ margin: 0, fontSize: 13.5, color: 'var(--color-subtle)' }}>
				Last.fm 사용자 이름을 연결하면 최근 들은 곡이 프로필에 나타나요. OAuth 없이 공개 프로필만 읽어요.
			</p>
			<Field label="Last.fm 사용자 이름">
				<input
					className="mono"
					style={FIELD_STYLE}
					value={username}
					onChange={(e) => {
						setUsername(e.target.value)
						setError(null)
					}}
					onKeyDown={(e) => {
 if (e.key === 'Enter')
onConnect()
}}
					autoComplete="off"
					spellCheck={false}
					placeholder="username"
					aria-label="Last.fm 사용자 이름"
				/>
			</Field>
			<div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
				{error && <span className="meta" role="alert" style={{ color: 'var(--color-accent)', textTransform: 'none' }}>{error}</span>}
				<button type="button" className="btn btn-solid" disabled={!username.trim() || busy} onClick={onConnect}>{busy ? '연결 중…' : '연결'}</button>
			</div>
		</div>
	)
}

// FEAT-multi-user 3b-e — Spotify connect. The button hands off to Spotify's
// authorize page; /settings/spotify/callback relays the code to the backend
// (server-side exchange, 3b-c) and returns here. status==='reauth' is the
// worker's invalid_grant signal (3b-d) — the row stays until the member
// reconnects or disconnects.
function SpotifyConnect({ initial }: { initial: Integration | null }) {
	const [conn, setConn] = useState<Integration | null>(initial)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const available = spotifyConnectAvailable()

	function onAuthorize() {
		const url = buildSpotifyAuthorizeUrl()
		if (url)
			location.assign(url)
	}

	async function onDisconnect() {
		if (busy)
			return
		setBusy(true)
		setError(null)
		const ok = await disconnectSpotify()
		setBusy(false)
		if (!ok) {
			setError('해제하지 못했어요. 잠시 후 다시 시도해 주세요.')
			return
		}
		setConn(null)
	}

	if (conn) {
		const needsReauth = conn.status === 'reauth'
		const statusLabel = needsReauth ?
			'다시 연결이 필요해요 — 재생 기록을 읽지 못하고 있어요' :
			conn.status === 'connected' ? '연결됨' : conn.status
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
					<span className="kicker">Spotify</span>
					<span className="meta" style={{ textTransform: 'none', color: needsReauth ? 'var(--color-accent)' : 'var(--color-subtle)' }}>{statusLabel}</span>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
					{error && <span className="meta" role="alert" style={{ color: 'var(--color-accent)', textTransform: 'none' }}>{error}</span>}
					{needsReauth && <button type="button" className="btn btn-solid" disabled={busy} onClick={onAuthorize}>다시 연결</button>}
					<button type="button" className="btn" disabled={busy} onClick={onDisconnect}>{busy ? '해제 중…' : '연결 해제'}</button>
				</div>
			</div>
		)
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<p className="sans" style={{ margin: 0, fontSize: 13.5, color: 'var(--color-subtle)' }}>
				Spotify 계정을 연결하면 최근 들은 곡과 지금 재생 중인 곡이 프로필에 나타나요. 재생 기록 읽기 권한만 요청해요.
			</p>
			<div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
				{!available && <span className="meta" style={{ textTransform: 'none' }}>연결 준비 중이에요</span>}
				<button type="button" className="btn btn-solid" disabled={!available} onClick={onAuthorize}>Spotify 연결</button>
			</div>
		</div>
	)
}

// 연동 panel body — one GET /api/integrations feeds every provider field.
function IntegrationsPanel() {
	const [rows, setRows] = useState<Integration[] | null>(null)

	useEffect(() => {
		let on = true
		getIntegrations().then((r) => {
			if (on)
				setRows(r)
		})
		return () => {
			on = false
		}
	}, [])

	if (rows == null)
		return <p className="meta" style={{ margin: 0 }}>불러오는 중…</p>

	return (
		<>
			<LastfmConnect initial={rows.find(r => r.provider === 'lastfm') ?? null} />
			<div style={{ borderTop: '1px solid var(--color-border)' }} />
			<SpotifyConnect initial={rows.find(r => r.provider === 'spotify') ?? null} />
		</>
	)
}

type SaveState = 'idle' | 'saving' | 'saved'

export function SettingsApp() {
	const [me, setMe] = useState<Me | null>(null)
	const [loadFailed, setLoadFailed] = useState(false)

	const [handle, setHandle] = useState('')
	const [displayName, setDisplayName] = useState('')
	const [saveState, setSaveState] = useState<SaveState>('idle')
	const [saveError, setSaveError] = useState<string | null>(null)

	const [confirmHandle, setConfirmHandle] = useState('')
	const [deleting, setDeleting] = useState(false)
	const [deleteError, setDeleteError] = useState<string | null>(null)

	useEffect(() => {
		let on = true
		getMe().then((m) => {
			if (!on)
				return
			if (!m) {
				setLoadFailed(true)
				return
			}
			setMe(m)
			setHandle(m.handle)
			setDisplayName(m.display_name)
		})
		return () => {
			on = false
		}
	}, [])

	const handleValid = HANDLE_RE.test(handle)
	const nameValid = displayName.trim().length >= 1 && displayName.length <= 80
	const dirty = me != null && (handle !== me.handle || displayName !== me.display_name)
	const canSave = dirty && handleValid && nameValid && saveState !== 'saving'

	// 저장/삭제 버튼이 뜬 '저장됨' 배지를 지우는 타이밍: 다음 편집 시.
	function edit<T>(setter: (v: T) => void) {
		return (v: T) => {
			setter(v)
			setSaveState('idle')
			setSaveError(null)
		}
	}

	async function onSave() {
		if (!me || !canSave)
			return
		setSaveState('saving')
		setSaveError(null)
		const patch: Record<string, string> = {}
		if (handle !== me.handle)
			patch.handle = handle
		if (displayName !== me.display_name)
			patch.display_name = displayName
		try {
			const next = await updateMe(patch)
			if (!next) {
				setSaveState('idle')
				setSaveError('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
				return
			}
			setMe(next)
			setHandle(next.handle)
			setDisplayName(next.display_name)
			setSaveState('saved')
		}
		catch (e) {
			setSaveState('idle')
			setSaveError(e instanceof HandleTakenError ? '이미 사용 중인 핸들이에요.' : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
		}
	}

	const deleteArmed = me != null && confirmHandle === me.handle
	async function onDelete() {
		if (!me || !deleteArmed || deleting)
			return
		setDeleting(true)
		setDeleteError(null)
		try {
			const ok = await deleteMe()
			if (!ok) {
				setDeleteError('삭제하지 못했어요. 잠시 후 같은 방법으로 다시 시도하면 이어서 처리돼요.')
				setDeleting(false)
				return
			}
			// 회원 정보가 사라졌으니 토큰도 정리하고 로그인 자체를 끝낸다.
			logout()
		}
		catch (e) {
			setDeleteError(e instanceof OwnerUndeletableError ? '운영자 계정은 여기서 삭제할 수 없어요.' : '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
			setDeleting(false)
		}
	}

	const joined = useMemo(() => {
		if (!me)
			return null
		const d = new Date(me.created_at)
		return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
	}, [me])

	if (loadFailed) {
		return (
			<div style={{ maxWidth: 560 }}>
				<SectionTitle kicker="ACCOUNT" title="설정" />
				<div className="panel" style={{ padding: 24, textAlign: 'center' }}>
					<span className="meta">프로필을 불러오지 못했어요 — 새로고침해 주세요.</span>
				</div>
			</div>
		)
	}

	return (
		<div style={{ maxWidth: 560 }}>
			<SectionTitle kicker="ACCOUNT" title="설정" right={joined && <span className="meta">{`가입 ${joined}`}</span>} />

			{me == null ?
					(
						<div className="meta" style={{ padding: '8px 0' }}>불러오는 중…</div>
					) :
					(
						<div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
							{/* 프로필 */}
							<section className="panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
								<div className="serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.1 }}>프로필</div>

								<Field label="핸들" hint="소문자·숫자·-·_ 3~30자. 프로필 주소에 쓰여요.">
									<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
										<span className="mono" style={{ color: 'var(--color-faded)', fontSize: 14 }}>@</span>
										<input
											className="mono"
											style={{
												...FIELD_STYLE,
												borderColor: handle && !handleValid ? 'var(--color-accent)' : 'var(--color-border)',
											}}
											value={handle}
											onChange={e => edit(setHandle)(e.target.value)}
											autoComplete="off"
											spellCheck={false}
											aria-label="핸들"
											aria-invalid={!!handle && !handleValid}
										/>
									</div>
								</Field>

								<Field label="표시 이름" hint="리뷰·버킷에 작성자로 보이는 이름이에요.">
									<input
										className="sans"
										style={FIELD_STYLE}
										value={displayName}
										onChange={e => edit(setDisplayName)(e.target.value)}
										maxLength={80}
										aria-label="표시 이름"
									/>
								</Field>

								<div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
									{saveError && <span className="meta" role="alert" style={{ color: 'var(--color-accent)', textTransform: 'none' }}>{saveError}</span>}
									{saveState === 'saved' && !dirty && <span className="meta">저장됨</span>}
									<button type="button" className="btn btn-solid" disabled={!canSave} onClick={onSave}>
										{saveState === 'saving' ? '저장 중…' : '저장'}
									</button>
								</div>
							</section>

							{/* 연동 — FEAT-multi-user 3a Last.fm + 3b Spotify (AI keys later) */}
							<section className="panel" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
								<div className="serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.1 }}>연동</div>
								<IntegrationsPanel />
							</section>

							{/* 계정 삭제 */}
							<section
								className="panel"
								style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14, borderColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)' }}
							>
								<div className="serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.1 }}>계정 삭제</div>
								<p className="sans" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-subtle)' }}>
									로그인 정보와 회원 정보를 지체 없이 삭제해요(개인정보처리방침 3항). 삭제한 계정은 되돌릴 수 없어요.
								</p>
								<Field label="핸들로 확인" hint={me ? `삭제하려면 ${me.handle} 을(를) 그대로 입력해 주세요.` : undefined}>
									<input
										className="mono"
										style={FIELD_STYLE}
										value={confirmHandle}
										onChange={(e) => {
											setConfirmHandle(e.target.value)
											setDeleteError(null)
										}}
										placeholder={me?.handle}
										autoComplete="off"
										spellCheck={false}
										aria-label="삭제 확인용 핸들"
									/>
								</Field>
								<div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
									{deleteError && <span className="meta" role="alert" style={{ color: 'var(--color-accent)', textTransform: 'none' }}>{deleteError}</span>}
									<button type="button" className="btn btn-accent" disabled={!deleteArmed || deleting} onClick={onDelete}>
										{deleting ? '삭제 중…' : '계정 삭제'}
									</button>
								</div>
							</section>
						</div>
					)}
		</div>
	)
}

export default SettingsApp
