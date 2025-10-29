// src/scripts/write.guard.ts
import { isLoggedIn, goLogin } from '../lib/auth'
;(async () => {
	if (!isLoggedIn()) {
		// 로그인 후 다시 /write 로 돌아오게
		await goLogin(true, '/write')
	}
})()
