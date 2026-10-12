// QR codes without internet: one phone draws its connection as a QR, the other reads
// it with the camera. Drawing: qrcode-generator (MIT). Reading: the browser's own
// BarcodeDetector where there is one (Chrome on Android), jsQR (Apache 2.0) elsewhere
// (Safari on the iPhone), loaded only when needed.

import qrcode from '../../vendor/qr/qrcode.js';

// a canvas with the code, black on white with its quiet zone (as large as `px`)
export function qrCanvas(text, px = 260) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), quiet = 3;
  const cell = Math.max(2, Math.floor(px / (n + quiet * 2)));
  const size = cell * (n + quiet * 2);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
  c.dataset.modules = n;
  return c;
}

let jsQR = null;
async function loadReader() {
  if ('BarcodeDetector' in window) {
    try {
      if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (src) => { const r = await det.detect(src); return r.length ? r[0].rawValue : null; };
      }
    } catch (e) { /* fall back to jsQR */ }
  }
  if (!jsQR) jsQR = (await import('../../vendor/qr/jsqr.js')).default;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, hh = video.videoHeight;
    if (!w || !hh) return null;
    const k = Math.min(1, 720 / Math.max(w, hh)); // enough pixels for a phone screen at arm's length
    cv.width = Math.round(w * k); cv.height = Math.round(hh * k);
    g.drawImage(video, 0, 0, cv.width, cv.height);
    const img = g.getImageData(0, 0, cv.width, cv.height);
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return r ? r.data : null;
  };
}

// The camera, looking for a code: onresult(text) for every code read (the caller
// decides if it is the right one). Errors: 'insecure' (no https), 'nocamera', 'denied'.
export class QRScanner {
  constructor(video) {
    this.video = video;
    this.onresult = null;
    this.running = false;
    this.stream = null;
    QRScanner.active = this; // tests feed codes through here (no camera in a headless browser)
  }
  async start() {
    const md = navigator.mediaDevices;
    if (!window.isSecureContext || !md || !md.getUserMedia) throw new Error('insecure');
    try {
      this.stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      throw new Error(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'nocamera');
    }
    const v = this.video;
    v.setAttribute('playsinline', ''); v.muted = true;
    v.srcObject = this.stream;
    try { await v.play(); } catch (e) { /* plays once the stream starts */ }
    this.read = await loadReader();
    this.running = true;
    this._loop();
  }
  async _loop() {
    while (this.running) {
      await new Promise((r) => setTimeout(r, 150));
      if (!this.running) break;
      try {
        const text = await this.read(this.video);
        if (text && this.running) this.feed(text);
      } catch (e) { /* a frame that could not be read */ }
    }
  }
  feed(text) { if (this.onresult) this.onresult(String(text)); }
  stop() {
    this.running = false;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (QRScanner.active === this) QRScanner.active = null;
  }
}
