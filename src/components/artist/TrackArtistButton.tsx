// FIX-user-flow-state-consistency leg 4 — track this artist, from the page
// where the reader decided they cared.
//
// The Release Radar could only be filled from inside /releases: preview a
// bucket, or import Spotify follows. Neither of those is where the decision
// happens. This is the missing seam between the two completed features, built
// entirely on the tracked-artists contract that already exists.
//
// Signed-out readers still see the control — hiding it hides the feature from
// exactly the people who have not found it yet — but it takes them to login
// with returnTo captured, rather than pretending to work.
import { useEffect, useState } from 'react'
import { goLogin, isLoggedIn } from '@lib/auth'
import { listTrackedArtists, trackArtist, untrackArtist } from '@lib/trackedArtists'

type State = 'anon' | 'loading' | 'off' | 'on' | 'unknown'

export default function TrackArtistButton({ artistId, name }: { artistId: string, name: string }) {
	const [state, setState] = useState<State>(() => (isLoggedIn() ? 'loading' : 'anon'))
	const [busy, setBusy] = useState(false)
	const [note, setNote] = useState('')

	useEffect(() => {
		if (!isLoggedIn())
			return
		const ac = new AbortController()
		let alive = true
		listTrackedArtists(ac.signal).then((rows) => {
			if (!alive)
				return
			// A failed read is its own state: claiming 추적 안 함 would invite a
			// POST the reader did not need, and claiming 추적 중 would be a lie.
			setState(rows === null ? 'unknown' : rows.some(r => r.artist_id === artistId) ? 'on' : 'off')
		})
		return () => {
			alive = false
			ac.abort()
		}
	}, [artistId])

	if (state === 'anon') {
		return (
			<button type="button" className="art-track mono" onClick={() => void goLogin(true)}>
				레이더에 추가
			</button>
		)
	}

	async function toggle() {
		if (busy || state === 'loading')
			return
		setBusy(true)
		setNote('')
		try {
			if (state === 'on') {
				const ok = await untrackArtist(artistId)
				setState(ok ? 'off' : 'on')
				setNote(ok ? `${name} 추적 해제` : '해제에 실패했습니다.')
				return
			}
			const res = await trackArtist(artistId)
			if (res.ok) {
				setState('on')
				setNote(res.alreadyTracked ? '이미 추적 중이었습니다.' : `${name} 추적 시작 — 새 발매가 레이더에 뜹니다.`)
				return
			}
			setNote(res.reason === 'limit' ?
				'오늘 추가 한도에 도달했어요 — 내일 다시 시도해 주세요.' :
				'추가에 실패했습니다. 잠시 후 다시 시도해 주세요.')
		}
		finally {
			setBusy(false)
		}
	}

	const label =
		state === 'loading' ?
			'…' :
			busy ?
				'처리 중…' :
				state === 'on' ?
					'추적 중 ✓' :
					'레이더에 추가'

	return (
		<span className="art-track-wrap">
			<button
				type="button"
				className={`art-track mono${state === 'on' ? ' is-on' : ''}`}
				onClick={() => void toggle()}
				disabled={busy || state === 'loading'}
				aria-pressed={state === 'on'}
				title={state === 'on' ? `${name} 추적 해제` : `${name}의 새 발매를 레이더에서 받기`}
			>
				{label}
			</button>
			{note && <span className="art-track-note mono" role="status">{note}</span>}
			{state === 'unknown' && !note && (
				<span className="art-track-note mono" role="status">추적 상태를 불러오지 못했습니다.</span>
			)}
		</span>
	)
}
