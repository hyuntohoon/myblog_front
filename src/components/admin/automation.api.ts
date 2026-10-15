// FEAT-automation-admin Step 2c — typed client for the owner's automation
// snapshot (backend 2b, `GET /api/admin/automation`).
//
// The route rides the edge_guard GET catch-all and is owner-gated in-Lambda by
// `require_owner` (decided in 2b's security-review; no apigateway route). So a
// signed-in member reaches the Lambda and gets 403, and a caller with no token
// gets 401. The page guard (scripts/ownerOnly.guard.ts) normally bounces a
// member first, but the server is the boundary: a 403 here is a real state the
// page renders, not an impossible one.
import { apiFetch } from '@lib/api'
import type { components } from '@lib/api.gen'

const BASE = import.meta.env.PUBLIC_BACKEND_API_URL as string

export type AutomationSnapshot = components['schemas']['Backend_AutomationSnapshot']
export type AutomationJob = components['schemas']['Backend_AutomationJob']
export type AutomationQueue = components['schemas']['Backend_AutomationQueue']
export type AutomationHeartbeat = components['schemas']['Backend_AutomationHeartbeatView']
export type AutomationSource = components['schemas']['Backend_AutomationSource']
export type Liveness = components['schemas']['Backend_AutomationLiveness']
// 2d: AWS evidence (names, counts and states only).
export type AutomationAws = components['schemas']['Backend_AutomationAws']
export type AutomationAwsQueue = components['schemas']['Backend_AutomationAwsQueue']
export type AutomationAwsFunction = components['schemas']['Backend_AutomationAwsFunction']
export type AutomationAwsAlarm = components['schemas']['Backend_AutomationAwsAlarm']

export type SnapshotResult =
	| { kind: 'ok', snapshot: AutomationSnapshot } |
	{ kind: 'forbidden' } |
	/** `status` null = no response at all (timeout, network, or a login redirect in flight). */
	{ kind: 'error', status: number | null }

export async function fetchAutomationSnapshot(signal?: AbortSignal): Promise<SnapshotResult> {
	const res = await apiFetch(`${BASE}/api/admin/automation`, { signal })
	if (!res)
		return { kind: 'error', status: null }
	if (res.status === 403)
		return { kind: 'forbidden' }
	if (!res.ok)
		return { kind: 'error', status: res.status }
	try {
		return { kind: 'ok', snapshot: (await res.json()) as AutomationSnapshot }
	}
	catch {
		return { kind: 'error', status: res.status }
	}
}

// ── 2f: one queue's detail (`GET /api/admin/automation/queue-detail?key=`) ──
// Reason CODES only — the server cuts them in SQL and never returns stored
// error text. Same owner gate: 403 for a member whatever the key.

export type QueueDetail = components['schemas']['Backend_AutomationQueueDetail']
export type ReasonCount = components['schemas']['Backend_AutomationReasonCount']
export type WaitingItem = components['schemas']['Backend_AutomationWaitingItem']

export type QueueDetailResult =
	| { kind: 'ok', detail: QueueDetail } |
	{ kind: 'forbidden' } |
	{ kind: 'error', status: number | null }

export async function fetchQueueDetail(key: string, signal?: AbortSignal): Promise<QueueDetailResult> {
	const res = await apiFetch(`${BASE}/api/admin/automation/queue-detail?key=${encodeURIComponent(key)}`, { signal })
	if (!res)
		return { kind: 'error', status: null }
	if (res.status === 403)
		return { kind: 'forbidden' }
	if (!res.ok)
		return { kind: 'error', status: res.status }
	try {
		return { kind: 'ok', detail: (await res.json()) as QueueDetail }
	}
	catch {
		return { kind: 'error', status: res.status }
	}
}

// ── 3b: pause / resume (`POST /api/admin/automation/controls`) ──
// A mutation, so unlike the GETs it has its own Cognito-JWT route in
// infra/apigateway.tf; `require_owner` in the Lambda is still the owner
// boundary (a member's token passes the authorizer and gets 403 here).
// The caller mints ONE request_id per confirmation and resends it unchanged
// after a 503 or no answer: the server applies it once or replays the stored
// result, so a retry can never act twice.

export type ControlAction = components['schemas']['Backend_AutomationControlRequest']['action']
export type ControlState = components['schemas']['Backend_AutomationControlState']
export type ControlOutcome = components['schemas']['Backend_AutomationControlResult']

export type ControlResult =
	| { kind: 'ok', result: ControlOutcome } |
	{ kind: 'forbidden' } |
	/** The job has no pause control (404), or the request_id was used for another job/action (409). */
	{ kind: 'rejected', status: 404 | 409 } |
	/** Outcome unknown (503, timeout, network): resend with the SAME request_id. */
	{ kind: 'error', status: number | null }

export async function postAutomationControl(jobKey: string, action: ControlAction, requestId: string): Promise<ControlResult> {
	const res = await apiFetch(`${BASE}/api/admin/automation/controls`, {
		method: 'POST',
		body: JSON.stringify({ job_key: jobKey, action, request_id: requestId }),
	})
	if (!res)
		return { kind: 'error', status: null }
	if (res.status === 403)
		return { kind: 'forbidden' }
	if (res.status === 404 || res.status === 409)
		return { kind: 'rejected', status: res.status }
	if (!res.ok)
		return { kind: 'error', status: res.status }
	try {
		return { kind: 'ok', result: (await res.json()) as ControlOutcome }
	}
	catch {
		return { kind: 'error', status: res.status }
	}
}
