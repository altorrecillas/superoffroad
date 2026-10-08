// Phone/tablet helpers: block page zoom and scrolling (iOS ignores user-scalable=no),
// go fullscreen in landscape when the game starts (Android).

export function blockPageZoom() {
  const stop = (e) => e.preventDefault();
  // iOS Safari ignores user-scalable=no: its pinch arrives as gesture* events
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.scale && e.scale !== 1) e.preventDefault(); }, { passive: false });
  // double-tap zoom is off through CSS touch-action (none on the page, pan-y on the
  // scrolling panels), so quick double taps on menu buttons still register
  document.addEventListener('contextmenu', stop);
}

// screen insets of the notch / rounded corners / home bar (iPhone landscape)
let probe = null;
export function safeInsets() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

// Fullscreen: browsers only grant it inside a user activation, which for touch
// means the finger lifting (pointerup / click), never pointerdown.
const iPhone = /iPhone|iPod/.test(navigator.userAgent);
export const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
export function canFullscreen() {
  const el = document.documentElement;
  return !standalone && !!(el.requestFullscreen || el.webkitRequestFullscreen) && document.fullscreenEnabled !== false;
}
export function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement) || standalone; }
// iPhone Safari cannot put a page in fullscreen: only "Add to Home Screen" can
export function needsHomeScreen() { return iPhone && !standalone; }

let pending = false;
export async function enterFullscreen(force = false) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  if ((!coarse && !force) || pending || isFullscreen() || !canFullscreen()) return;
  if (navigator.userActivation && !navigator.userActivation.isActive) return; // would be refused
  const el = document.documentElement;
  pending = true;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen();
  } catch (e) { return; /* not allowed here */ } finally { pending = false; }
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* not supported */ }
}
export function exitFullscreen() {
  try { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) { /* */ }
}
