// FEAT-mobile-web-app Step 4 — service worker registration (autoUpdate: new
// deploys activate on the next visit; no update prompt UI by design).
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })
