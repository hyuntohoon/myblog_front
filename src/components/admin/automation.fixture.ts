// Test fixture: a trimmed copy of a real `GET /api/admin/automation` response
// (local backend 859815c against prod, read-only, 2026-10-12 10:31 UTC). Queue
// counts are the real ones; the job list keeps one row per group. Heartbeats
// are empty, as they are in prod until 2e.
import type { AutomationJob, AutomationSnapshot, QueueDetail } from './automation.api'

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

// 2f detail fixtures: the real `GET /api/admin/automation/queue-detail` answers
// (local backend 2fbbe7d against prod, read-only, 2026-10-12 ~14:05 UTC),
// trimmed to two oldest rows each.
const OBSERVED = '2026-10-12T14:20:00Z'

export function realDetails(): Record<string, QueueDetail> {
	return {
		'lyrics_translation_work:claude.sonnet/v2': {
			key: 'lyrics_translation_work:claude.sonnet/v2',
table: 'lyrics_translation_work',
label: 'Claude demand translation (legacy)',
frozen: true,
waiting_states: ['ready', 'retryable_error'],
status: 'ok',
observed_at: OBSERVED,
reasons_note: null,
			reasons: [
				{ state: 'done', reason: null, count: 1915, deferred: 0 },
				{ state: 'retryable_error', reason: 'engine_validation', count: 169, deferred: 0 },
				{ state: 'cancelled', reason: null, count: 93, deferred: 0 },
				{ state: 'running', reason: null, count: 38, deferred: 0 },
				{ state: 'running', reason: 'engine_validation', count: 32, deferred: 0 },
			],
			flow: { window_hours: 24, entered: 0, left: 0, entered_basis: 'Work rows created in the window.', left_basis: 'Approximate: work rows now done or cancelled whose last update is in the window.' },
			wait_basis: 'Since the work row was created.',
oldest_limit: 5,
			oldest_waiting: [
				{ id: '6b876d31-1de9-4a7c-9a52-1f0e2d3c4b5a', title: 'limelight', state: 'retryable_error', reason: 'engine_validation', attempts: 17, waiting_since: '2026-09-23T07:09:58Z', next_attempt_at: '2026-10-05T04:02:02Z' },
				{ id: '48505620-cbfc-4f1e-8d2a-7c6b5a4f3e2d', title: 'Hood Politics', state: 'retryable_error', reason: 'engine_validation', attempts: 14, waiting_since: '2026-09-23T17:01:00Z', next_attempt_at: '2026-10-04T23:14:29Z' },
			],
		},
		'lyrics_album_jobs': {
			key: 'lyrics_album_jobs',
table: 'lyrics_album_jobs',
label: 'Lyrics album demand jobs',
frozen: false,
waiting_states: ['pending'],
status: 'ok',
observed_at: OBSERVED,
reasons_note: null,
			reasons: [
				{ state: 'pending', reason: 'album_not_in_catalog', count: 848, deferred: 848 },
				{ state: 'complete', reason: null, count: 628, deferred: 0 },
				{ state: 'cancelled', reason: 'album_not_in_catalog', count: 8, deferred: 0 },
				{ state: 'pending', reason: 'album_partially_ingested', count: 5, deferred: 5 },
				{ state: 'pending', reason: 'album_has_no_tracks', count: 1, deferred: 1 },
			],
			flow: { window_hours: 24, entered: 14, left: 19, entered_basis: 'Jobs created in the window.', left_basis: 'Approximate: jobs now complete or cancelled whose last update is in the window.' },
			wait_basis: 'Since the job was created.',
oldest_limit: 5,
			oldest_waiting: [
				{ id: '0f3AAclv8NgV0jXxYz1234', title: null, state: 'pending', reason: 'album_not_in_catalog', attempts: null, waiting_since: '2026-09-10T23:54:03Z', next_attempt_at: '2026-10-12T22:37:25Z' },
				{ id: '0CvwwhkzMUiDm8AbCd5678', title: null, state: 'pending', reason: 'album_not_in_catalog', attempts: null, waiting_since: '2026-09-19T03:39:07Z', next_attempt_at: '2026-10-13T03:07:25Z' },
			],
		},
		'track_genius_annotations': {
			key: 'track_genius_annotations',
table: 'track_genius_annotations',
label: 'Genius annotation translations',
frozen: false,
waiting_states: ['pending'],
status: 'ok',
observed_at: OBSERVED,
			reasons_note: 'This table has no reason column.',
			reasons: [
				{ state: 'done', reason: null, count: 6596, deferred: null },
				{ state: 'failed', reason: null, count: 23, deferred: null },
				{ state: 'pending_ineligible', reason: null, count: 12, deferred: null },
			],
			flow: { window_hours: 24, entered: 0, left: 0, entered_basis: 'Annotations fetched in the window.', left_basis: 'Annotations translated in the window.' },
			wait_basis: 'Since the annotation was fetched.',
oldest_limit: 5,
oldest_waiting: [],
		},
	}
}

// 2d fixture: the AWS half of a real `GET /api/admin/automation` answer (local
// backend at the 2d branch, AWS read as claude_aws_manager, 2026-10-13 03:13
// UTC), trimmed. The DB half is realSnapshot()'s; prod read 0 everywhere, so
// tests that need a failure change one item.
const AWS_AT = '2026-10-13T03:13:11.384112Z'

export function awsSnapshot(): AutomationSnapshot {
	const base = realSnapshot()
	return {
		...base,
		generated_at: '2026-10-13T03:13:14.541809Z',
		sources: base.sources.map(s => s.key === 'aws' ? { key: 'aws', status: 'ok', observed_at: '2026-10-13T03:13:14.533343Z', detail: '4 of 4 reads succeeded.' } : s),
		jobs: base.jobs.map(j => j.key === 'lyrics_demand_source' ?
			{ ...j, liveness: { status: 'fresh', observed_at: '2026-10-13T12:05:00+09:00', age_seconds: 491, reason: 'Delivered within the 1800s bound; 96 delivered, 0 failed in 24 h; alarm OK. Delivery only: whether the handler succeeded is not per-rule evidence.' } } :
			j),
		aws: {
			rules: [
				{ job_key: 'lyrics_demand_source', rule: 'worker-lyrics-demand-source', status: 'ok', observed_at: AWS_AT, state: 'ENABLED', schedule: 'rate(15 minutes)', last_delivery_at: '2026-10-13T12:05:00+09:00', delivered_24h: 96, failed_24h: 0, lookback_hours: 24, alarm: 'worker-lyrics-demand-source-failed-invocations', last_attempt_failed: false },
			],
			queues: [
				{ name: 'blogSQS', role: 'work', label: 'Worker job queue', status: 'ok', observed_at: AWS_AT, visible: 0, in_flight: 0, delayed: 0 },
				{ name: 'album-sync-dlq', role: 'dead_letter', label: 'blogSQS dead letters (after 3 receives)', status: 'ok', observed_at: AWS_AT, visible: 0, in_flight: 0, delayed: 0 },
				{ name: 'worker-cron-dlq', role: 'dead_letter', label: 'Failed async cron invocations', status: 'ok', observed_at: AWS_AT, visible: 0, in_flight: 0, delayed: 0 },
			],
			functions: [
				{ name: 'ratemymusic-api', label: 'Backend API', status: 'ok', observed_at: AWS_AT, invocations_24h: 337, errors_24h: 0, throttles_24h: 0 },
				{ name: 'musicApi', label: 'Music API', status: 'ok', observed_at: AWS_AT, invocations_24h: 301, errors_24h: 0, throttles_24h: 0 },
				{ name: 'blogWorkerLambda', label: 'Worker (crons + blogSQS)', status: 'ok', observed_at: AWS_AT, invocations_24h: 590, errors_24h: 0, throttles_24h: 0 },
			],
			alarms: [
				{ name: 'worker-lyrics-demand-source-failed-invocations', status: 'ok', observed_at: AWS_AT, state: 'OK', state_updated_at: '2026-06-04T19:18:03.434000+09:00' },
				{ name: 'blogWorkerLambda-errors', status: 'ok', observed_at: AWS_AT, state: 'OK', state_updated_at: '2026-10-01T00:00:00Z' },
				{ name: 'album-sync-dlq-messages', status: 'ok', observed_at: AWS_AT, state: 'OK', state_updated_at: '2026-10-01T00:00:00Z' },
			],
		},
	}
}
