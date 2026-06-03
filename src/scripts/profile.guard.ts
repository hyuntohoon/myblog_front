// src/scripts/profile.guard.ts
import { goLogin, isLoggedIn } from '../lib/auth'
;

(async () => {
	if (!isLoggedIn()) {
		// 로그인 후 다시 /profile 로 돌아오게
		await goLogin(true, '/profile')
	}
})()
