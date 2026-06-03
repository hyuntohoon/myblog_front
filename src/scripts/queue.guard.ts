// FEAT-review-bucket-board Step 4 — /reviews/queue is an owner-only editing
// tool, same gate as /write. Redirect anonymous visitors to login.
import { goLogin, isLoggedIn } from '../lib/auth'

;

(async () => {
  if (!isLoggedIn()) {
    await goLogin(true, '/reviews/queue')
  }
})()
