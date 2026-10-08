// Minimal DOM UI layer: screens, navigable menus (keyboard, gamepad, mouse,
// touch) and toasts.

export const $ = (sel, root = document) => root.querySelector(sel);
export const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// keep a focused item visible inside its (possibly scaled) scrolling panel
function revealInPanel(el) {
  const p = el.closest('.panel');
  if (!p || p.scrollHeight <= p.clientHeight + 1) return;
  const pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
  const k = pr.height / p.offsetHeight || 1; // on-screen px per panel px
  if (er.top < pr.top) p.scrollTop -= (pr.top - er.top) / k + 8;
  else if (er.bottom > pr.bottom) p.scrollTop += (er.bottom - pr.bottom) / k + 8;
}

export class UI {
  constructor(root, input, sound) {
    this.root = root;
    this.input = input;
    this.sound = sound || (() => {});
    this.screens = new Map();
    this.nav = null;
    input.onUI((a, src) => this._ui(a, src));
    // panels re-fit when the viewport changes (rotation, browser bars, fullscreen)
    let pending = 0;
    const refit = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => this.refit()); };
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    document.addEventListener('fullscreenchange', refit);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
  }

  show(id, html, cls = '') {
    this.hide(id);
    const el = h(`<div class="screen ${cls}" id="${id}">${html}</div>`);
    this.root.appendChild(el);
    this.screens.set(id, el);
    this.fit(el);
    // content that changes after showing (values painted, letters, images, fonts)
    // re-fits on the next frame; outside the observer callback so it cannot loop
    if (window.ResizeObserver && el.querySelector('.panel')) {
      let raf = 0;
      el._ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (el.isConnected) this.fit(el); }); });
      for (const p of el.querySelectorAll('.panel')) for (const c of p.children) el._ro.observe(c);
    }
    return el;
  }

  // Scale a screen's panels so they fit whole: short landscape phones with browser
  // bars can have barely 320 px of height. Below a readable minimum the panel keeps
  // that scale and scrolls inside instead.
  fit(el, min = 0.6) {
    const panels = el.querySelectorAll('.panel');
    if (!panels.length) return;
    const cs = getComputedStyle(el);
    const availH = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (availH <= 0 || availW <= 0) return;
    for (const p of panels) {
      // measure the whole content: no max-height and no flex shrinking (a scrolling
      // flex item would otherwise squeeze itself to the screen and just scroll)
      p.style.scale = ''; p.style.maxHeight = 'none'; p.style.flexShrink = '0';
      const ph = p.offsetHeight, pw = p.offsetWidth;
      let k = Math.min(1, availH / ph, availW / pw);
      if (k >= 0.995) { p.style.maxHeight = ''; p.style.flexShrink = ''; continue; }
      // reading screens set their own floor (data-min-scale) and scroll below it
      k = Math.max(min, +(p.dataset.minScale || 0), k);
      // the individual 'scale' property: the fade-in animation owns 'transform'
      p.style.transformOrigin = cs.alignItems === 'flex-end' ? 'right center' : 'center center';
      p.style.scale = k.toFixed(3);
      p.style.maxHeight = ph * k > availH + 1 ? `${(availH / k).toFixed(0)}px` : 'none';
    }
  }
  refit() { for (const el of this.screens.values()) this.fit(el); }
  hide(id) {
    const el = this.screens.get(id);
    if (el) { if (el._ro) el._ro.disconnect(); el.remove(); this.screens.delete(id); }
    if (this.nav && this.nav.screen === id) this.nav = null;
  }
  hideAll(except = []) { for (const id of [...this.screens.keys()]) if (!except.includes(id)) this.hide(id); }
  get(id) { return this.screens.get(id); }

  // make a list of elements navigable. items: elements with data-i; handlers per element
  navigate(screenId, elements, opts = {}) {
    const nav = {
      screen: screenId, els: elements, i: opts.start ?? 0,
      axis: opts.axis || 'v', onOk: opts.onOk, onBack: opts.onBack, onLeft: opts.onLeft, onRight: opts.onRight, onFocus: opts.onFocus,
      onUp: opts.onUp, onDown: opts.onDown,
      grid: opts.grid || 0,
    };
    // skip disabled starting items
    const valid = (k) => nav.els[k] && !nav.els[k].classList.contains('disabled');
    if (!valid(nav.i)) nav.i = Math.max(0, nav.els.findIndex((e, k) => valid(k)));
    const focus = (k, silent) => {
      if (k < 0 || k >= nav.els.length) return;
      nav.els.forEach((e) => e.classList.remove('focus'));
      nav.i = k;
      nav.els[k].classList.add('focus');
      revealInPanel(nav.els[k]);
      if (!silent) this.sound('move');
      nav.onFocus && nav.onFocus(k);
    };
    nav.focus = focus;
    elements.forEach((el, k) => {
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') focus(k, true); });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (el.classList.contains('disabled')) { this.sound('deny'); return; }
        focus(k, true);
        // clicks on option values cycle them
        if (el.dataset.opt != null && nav.onRight) { nav.onRight(k, el); this.sound('move'); return; }
        this.sound('ok');
        nav.onOk && nav.onOk(k, el);
      });
    });
    focus(nav.i, true);
    this.nav = nav;
    return nav;
  }

  _ui(a) {
    const n = this.nav;
    if (!n || !this.screens.has(n.screen)) return;
    const prevKey = n.axis === 'v' ? 'up' : 'left', nextKey = n.axis === 'v' ? 'down' : 'right';
    const step = (d) => {
      let k = n.i;
      for (let t = 0; t < n.els.length; t++) {
        k = (k + d + n.els.length) % n.els.length;
        if (!n.els[k].classList.contains('disabled') || n.allowDisabled) break;
      }
      n.focus(k);
    };
    if (n.grid) {
      if (a === 'left') return step(-1);
      if (a === 'right') return step(1);
      // up/down go to the nearest item in that direction on screen, so a grid
      // with any number of columns flows into the buttons under it and back
      if (a === 'up' || a === 'down') return this._vertical(n, a === 'down' ? 1 : -1);
    }
    // horizontal lists can use up/down for something else (e.g. truck / buggy)
    if (n.axis === 'h' && a === 'up' && n.onUp) { n.onUp(n.i, n.els[n.i]); return; }
    if (n.axis === 'h' && a === 'down' && n.onDown) { n.onDown(n.i, n.els[n.i]); return; }
    if (a === prevKey) return step(-1);
    if (a === nextKey) return step(1);
    if (a === 'left' && n.onLeft) { n.onLeft(n.i, n.els[n.i]); this.sound('move'); return; }
    if (a === 'right' && n.onRight) { n.onRight(n.i, n.els[n.i]); this.sound('move'); return; }
    if (a === 'ok') {
      const el = n.els[n.i];
      if (el.classList.contains('disabled')) { this.sound('deny'); return; }
      this.sound('ok');
      n.onOk && n.onOk(n.i, el);
      return;
    }
    if (a === 'back' && n.onBack) { this.sound('back'); n.onBack(); }
  }

  _vertical(n, dir) {
    const c = n.els[n.i].getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    let best = -1, bestScore = Infinity, wrap = -1, wrapScore = Infinity;
    n.els.forEach((e, k) => {
      if (k === n.i || (e.classList.contains('disabled') && !n.allowDisabled)) return;
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dy = (y - cy) * dir;
      if (dy > 4) { const sc = dy + Math.abs(x - cx) * 2; if (sc < bestScore) { bestScore = sc; best = k; } }
      // nothing further that way: wrap to the far side, same column if possible
      const sw = -dy * 3 + Math.abs(x - cx);
      if (dy < -4 && sw < wrapScore) { wrapScore = sw; wrap = k; }
    });
    const k = best >= 0 ? best : wrap;
    if (k >= 0) n.focus(k);
  }

  toast(text, cls = '', ms = 1500) {
    let zone = this.root.querySelector('.toast-zone');
    if (!zone) { zone = h('<div class="toast-zone"></div>'); this.root.appendChild(zone); }
    const t = h(`<div class="toast ${cls}">${text}</div>`);
    zone.appendChild(t);
    while (zone.children.length > 3) zone.firstChild.remove();
    setTimeout(() => { t.style.transition = 'opacity 0.35s, transform 0.35s'; t.style.opacity = '0'; t.style.transform = 'translateY(-14px)'; }, ms);
    setTimeout(() => t.remove(), ms + 400);
  }
  clearToasts() { const z = this.root.querySelector('.toast-zone'); if (z) z.innerHTML = ''; }
}
