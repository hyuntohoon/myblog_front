// src/scripts/write.guard.ts
import { goLogin, isLoggedIn } from '../lib/auth'
;

(async () => {
	if (!isLoggedIn()) {
		// 로그인 후에는 항상 홈으로 이동한다(콜백 처리에서 결정).
		await goLogin(true)
	}
})()
