// Offline start and background updates for the installed app (D45, Phase 5a).
//
// On the GitHub Pages site the build serves dist/sw.js beside the page. The page
// registers it only when it is a built page served over https; the dev server, files
// opened from disk and copies hosted without sw.js skip it (a failed registration is
// silent). graphcalc.html works the same with or without the worker.
//
// Updates: the browser re-checks sw.js on each launch (and we ask again when the app
// comes back to the foreground, at most hourly). A changed worker installs, saves the
// new page and waits. The page then shows a lasting "New version · Reload" toast; the
// tap saves the work, tells the waiting worker to take over and reloads once it has.
import { showToast } from './toast.js';

const RECHECK_MS = 60 * 60 * 1000;

function standalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  } catch {
    return false;
  }
}

// Ask once per launch, silently, for storage that isn't cleared under pressure – only when
// running installed, where Chrome, Edge and Safari decide without a prompt (Q4).
async function persistStorage() {
  try {
    if (!standalone() || !navigator.storage || !navigator.storage.persist) return;
    if (navigator.storage.persisted && await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch { /* not supported */ }
}

export function setUpOffline({ isBuilt, beforeReload }) {
  persistStorage();
  if (!isBuilt || location.protocol !== 'https:' || !('serviceWorker' in navigator)) return;

  const sw = navigator.serviceWorker;
  let reloading = false;
  let offered = false;

  sw.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });

  function offer(reg) {
    // A waiting worker with no controller is a first install, which activates by itself.
    if (offered || !reg.waiting || !sw.controller) return;
    offered = true;
    showToast('New version', {
      lasting: true,
      action: {
        label: 'Reload',
        onClick() {
          try { beforeReload(); } catch { /* still reload */ }
          reloading = true;
          if (reg.waiting) reg.waiting.postMessage({ type: 'skip-waiting' });
          else location.reload(); // another window already switched over
        },
      },
    });
  }

  sw.register('./sw.js').then((reg) => {
    offer(reg);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer(reg);
      });
    });
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < RECHECK_MS) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    });
  }).catch(() => { /* no sw.js here, or service workers disabled */ });
}
