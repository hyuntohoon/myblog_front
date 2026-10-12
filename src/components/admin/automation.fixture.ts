// Test fixture: a trimmed copy of a real `GET /api/admin/automation` response
// (local backend 859815c against prod, read-only, 2026-10-12 10:31 UTC). Queue
// counts are the real ones; the job list keeps one row per group. Heartbeats
// are empty, as they are in prod until 2e.
import type { AutomationJob, AutomationSnapshot } from './automation.api'

export function job(over: Partial<AutomationJob> & Pick<AutomationJob, 'key'>): AutomationJob {
	return {
		group: 'aws_schedule',
		name: over.key,
		purpose: 'p',
		trigger: 't',
		executor: 'blogWorkerLambda',
		location: 'aws',
		declared_state: 'active',
		liveness: { status: 'unknown', observed_at: null, age_seconds: null, reason: 'No adapter.' },
		...over,
	}
}

export function realSnapshot(): AutomationSnapshot {
	return {
		generated_at: '2026-10-12T10:31:33.614489Z',
		catalog_as_of: '2026-10-12',
		sources: [
			{ key: 'catalog', status: 'ok', observed_at: null, detail: 'Step 1 inventory as of 2026-10-12.' },
			{ key: 'db', status: 'ok', observed_at: '2026-10-12T10:31:33.614489Z', detail: null },
			{ key: 'heartbeat', status: 'ok', observed_at: '2026-10-12T10:31:33.614489Z', detail: '0 agent(s) reporting.' },
			{ key: 'aws', status: 'not_wired', observed_at: null, detail: 'FEAT-automation-admin 2d.' },
		],
		queues: [
			{ key: 'lyrics_album_jobs', table: 'lyrics_album_jobs', label: 'Lyrics album demand jobs', frozen: false, waiting_states: ['pending'], status: 'ok', observed_at: '2026-10-12T10:31:33.614489Z', counts: { cancelled: 8, pending: 854, complete: 627 }, oldest_waiting_at: '2026-09-10T23:54:03.374442Z', last_update_at: '2026-10-12T10:22:44.514238Z', stale_running: null },
			{ key: 'track_genius_annotations', table: 'track_genius_annotations', label: 'Genius annotation translations', frozen: false, waiting_states: ['pending'], status: 'ok', observed_at: '2026-10-12T10:31:33.614489Z', counts: { done: 6596, failed: 23, pending_ineligible: 12 }, oldest_waiting_at: null, last_update_at: '2026-08-15T20:45:20.579605Z', stale_running: null },
			{ key: 'lyrics_translation_work:chatgpt/lyrics-ko-v1', table: 'lyrics_translation_work', label: 'GPT lyrics translation', frozen: false, waiting_states: ['ready', 'retryable_error'], status: 'ok', observed_at: '2026-10-12T10:31:33.614489Z', counts: { retryable_error: 26, done: 552 }, oldest_waiting_at: '2026-10-09T08:11:37.690560Z', last_update_at: '2026-10-12T08:09:04.279213Z', stale_running: 0 },
			{ key: 'lyrics_translation_work:chatgpt/genius-ko-v1', table: 'lyrics_translation_work', label: 'GPT Genius annotation translation', frozen: false, waiting_states: ['ready', 'retryable_error'], status: 'ok', observed_at: '2026-10-12T10:31:33.614489Z', counts: {}, oldest_waiting_at: null, last_update_at: null, stale_running: null },
			{ key: 'lyrics_translation_work:claude.sonnet/v2', table: 'lyrics_translation_work', label: 'Claude demand translation (legacy)', frozen: true, waiting_states: ['ready', 'retryable_error'], status: 'ok', observed_at: '2026-10-12T10:31:33.614489Z', counts: { done: 1915, retryable_error: 169, running: 70, cancelled: 93 }, oldest_waiting_at: '2026-09-23T07:09:58.926696Z', last_update_at: '2026-10-09T17:15:24.741186Z', stale_running: 70 },
		],
		jobs: [
			job({ key: 'lyrics_demand_source', name: 'Lyrics demand collection', trigger: 'EventBridge rule worker-lyrics-demand-source · rate(15 min)', timezone: 'UTC', queue_keys: ['lyrics_album_jobs'], liveness: { status: 'unknown', observed_at: null, age_seconds: null, reason: 'AWS adapter not wired (2d).' } }),
			job({ key: 'scheduler_start_blog_db', group: 'aws_scheduler', name: 'StartBlogDB', declared_state: 'obsolete', executor: 'Lambda mydbhandler (deleted)' }),
			job({ key: 'gpt-translate-poller', group: 'local_agent', name: 'GPT translation worker', location: 'mac', declared_state: 'active', ai_provider: 'OpenAI ChatGPT plan (local worker)', heartbeat_key: 'gpt-translate-poller', stale_after_seconds: 900, queue_keys: ['lyrics_translation_work:chatgpt/lyrics-ko-v1'], liveness: { status: 'unknown', observed_at: null, age_seconds: null, reason: 'No heartbeat reported.' } }),
			job({ key: 'verifier_drift', group: 'other_scheduler', name: 'Cognito verifier drift check', location: 'github', executor: 'GitHub Actions (myblog-workspace)' }),
		],
		heartbeats: [],
	}
}
