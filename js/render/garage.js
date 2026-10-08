// Ironman's Speed Shop: an indoor garage with a turntable, used by the
// upgrade shop and to render the truck portraits of the selection screen.

import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TruckView } from './truckview.js';
import { truckDef } from '../game/drivers.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Garage {
  constructor(view, templates) {
    this.view = view;
    this.templates = templates; // { truck, buggy }
    const s = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.3, 200);
    s.background = new THREE.Color(0x0b0b0d);
    s.fog = new THREE.Fog(0x0b0b0d, 18, 46);
    s.environment = view.scene.environment;
    s.environmentIntensity = 0.35;

    // floor: dark epoxy with safety lines
    const floorTex = canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = '#2b2c2f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.strokeStyle = '#d9a816'; g.lineWidth = 14;
      g.beginPath(); g.arc(w / 2, h / 2, w * 0.33, 0, Math.PI * 2); g.stroke();
      g.setLineDash([40, 30]); g.lineWidth = 10;
      g.beginPath(); g.moveTo(0, h * 0.92); g.lineTo(w, h * 0.92); g.stroke();
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.38, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);

    // walls: corrugated panels above a red/white striped band
    const wallTex = canvasTex(512, 512, (g, w, h) => {
      for (let x = 0; x < w; x += 16) {
        const grad = g.createLinearGradient(x, 0, x + 16, 0);
        grad.addColorStop(0, '#2d3a4d'); grad.addColorStop(0.5, '#4a5b75'); grad.addColorStop(1, '#2d3a4d');
        g.fillStyle = grad; g.fillRect(x, 0, 16, h * 0.72);
      }
      for (let x = 0; x < w; x += 64) { g.fillStyle = (x / 64) % 2 ? '#e8e6e0' : '#c21b14'; g.fillRect(x, h * 0.72, 64, h * 0.2); }
      g.fillStyle = '#1a1a1c'; g.fillRect(0, h * 0.92, w, h * 0.08);
    });
    wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(5, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.35 });
    for (const [x, z, ry, w] of [[0, -11, 0, 34], [-14, 0, Math.PI / 2, 26], [14, 0, -Math.PI / 2, 26]]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, 7), wallMat);
      wall.position.set(x, 3.5, z); wall.rotation.y = ry;
      wall.receiveShadow = true;
      s.add(wall);
    }
    // neon sign
    const signTex = canvasTex(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = 'italic 900 120px "Russo", "Arial Black", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#ff2a1a'; g.shadowBlur = 30;
      g.fillStyle = '#ffd5c2'; g.fillText('SPEED SHOP', w / 2, h * 0.58);
      g.font = 'italic 700 46px "Russo", "Arial Black", sans-serif';
      g.shadowColor = '#ffb21a'; g.fillStyle = '#ffe9a8'; g.fillText("IRONMAN'S", w / 2, h * 0.16);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false, color: new THREE.Color(2.2, 2.2, 2.2) }));
    sign.position.set(0, 5.1, -10.9);
    s.add(sign);
    // ceiling light strips
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.8), toneMapped: false });
    for (const x of [-6, 0, 6]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 9), stripMat);
      st.position.set(x, 6.9, -2);
      s.add(st);
    }
    // props: tyre stacks, tool chests, drums
    const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85 });
    const tyre = new THREE.TorusGeometry(0.45, 0.2, 10, 24); tyre.rotateX(Math.PI / 2);
    for (const [x, z, n] of [[-10.5, -8.5, 5], [-9.2, -8.8, 3], [10.6, -8.2, 4], [11.5, -5.5, 2]]) {
      for (let k = 0; k < n; k++) { const t = new THREE.Mesh(tyre, rubber); t.position.set(x, 0.2 + k * 0.38, z); t.castShadow = t.receiveShadow = true; s.add(t); }
    }
    const chest = new THREE.MeshStandardMaterial({ color: 0xb3150f, roughness: 0.35, metalness: 0.4 });
    for (const [x, z] of [[-6, -10], [7.2, -10]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.9), chest);
      c.position.set(x, 0.8, z); c.castShadow = c.receiveShadow = true; s.add(c);
      for (let k = 0; k < 4; k++) { const d = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.03, 0.02), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.2 })); d.position.set(x, 0.35 + k * 0.32, z + 0.46); s.add(d); }
    }
    const drumMat = new THREE.MeshStandardMaterial({ color: 0x1f4fbf, roughness: 0.4, metalness: 0.5 });
    for (const [x, z] of [[11, -9.3], [12.2, -9]]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.3, 20), drumMat); d.position.set(x, 0.65, z); d.castShadow = true; s.add(d); }

    // turntable
    const plateTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#7b7f86'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
        g.save(); g.translate(x + 16, y + 16); g.rotate(((x + y) / 32) % 2 ? 0.8 : -0.8);
        g.fillStyle = '#a6aab1'; g.fillRect(-10, -3, 20, 6); g.restore();
      }
    });
    plateTex.wrapS = plateTex.wrapT = THREE.RepeatWrapping; plateTex.repeat.set(4, 4);
    this.table = new THREE.Group();
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.3, 0.22, 64), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.55, metalness: 0.55 }));
    disk.position.y = 0.11;
    disk.receiveShadow = true;
    this.table.add(disk);
    s.add(this.table);

    // lights
    s.add(new THREE.HemisphereLight(0x8090b0, 0x302520, 0.5));
    const key = new THREE.SpotLight(0xfff0dc, 240, 0, 0.62, 0.7, 2);
    key.position.set(6, 9, 6); key.target.position.set(0, 0.6, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; key.shadow.radius = 4;
    const rim = new THREE.SpotLight(0x9fc4ff, 150, 0, 0.6, 0.7, 2);
    rim.position.set(-7, 6, -6); rim.target.position.set(0, 0.8, 0);
    const fill = new THREE.PointLight(0xff9a5c, 25, 0, 2);
    fill.position.set(0, 4.5, -9.5);
    s.add(key, key.target, rim, rim.target, fill);
    this.truck = null;
    this.t = 0;
  }

  setTruck(truckId, kind = 'truck') {
    if (this.truck) { this.table.remove(this.truck.root); this.truck.dispose(); }
    const d = truckDef(truckId);
    this.truck = new TruckView({ color: d.color, accent: d.accent, number: d.number, helmet: d.helmet }, this.templates[kind] || this.templates.truck);
    this.truck.root.position.y = 0.22;
    this.table.add(this.truck.root);
    this._still();
    return this.truck;
  }
  _still() {
    // settle the suspension once, wheels on the table
    const flat = { heightAt: () => 0 };
    const st = { x: 0, y: 0, z: 0, h: 0, vf: 0, w: 0, vy: 0, air: false, steer: 0.35, landKick: 0 };
    for (let i = 0; i < 30; i++) this.truck.update(st, 1 / 30, flat);
    this.truck.root.position.set(0, 0.22, 0);
    this.truck.root.rotation.set(0, 0, 0);
  }

  update(dt) {
    this.t += dt;
    this.table.rotation.y = this.t * 0.35;
    const a = 0.6 + Math.sin(this.t * 0.2) * 0.12;
    this.camera.position.set(Math.cos(a) * 9.6, 3.6, Math.sin(a) * 9.6 + 1.2);
    this.camera.lookAt(0, 1.55, 0);
    // keep the truck left of the shop panel
    const W = 1000, H = Math.round(W / this.camera.aspect);
    this.camera.setViewOffset(W, H, this.offsetX ?? 210, 0, W, H);
  }

  // offscreen portraits of each livery for the selection cards
  portraits(ids, kind = 'truck', w = 360, h = 200) {
    const r = this.view.renderer;
    // render linear HDR, then tone map + sRGB with an OutputPass into a second target
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    const rtOut = new THREE.WebGLRenderTarget(w, h);
    const outPass = new OutputPass();
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.3, 100);
    const out = {};
    const prevBg = this.scene.background, prevFog = this.scene.fog;
    this.scene.background = null; this.scene.fog = null;
    const pixels = new Uint8Array(w * h * 4);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const prevTM = r.toneMapping;
    for (const id of ids) {
      this.setTruck(id, kind);
      this.table.rotation.y = 0;
      const buggy = kind === 'buggy'; // lower and narrower: closer, more side-on
      this.truck.root.rotation.y = buggy ? 0.12 : -0.55;
      this.truck.setLights(false);
      if (buggy) cam.position.set(4.9, 2.3, 4.3); else cam.position.set(5.6, 2.6, 4.9);
      cam.lookAt(0, buggy ? 0.85 : 0.95, 0);
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.scene, cam);
      outPass.render(r, rtOut, rt);
      r.readRenderTargetPixels(rtOut, 0, 0, w, h, pixels);
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      g.putImageData(img, 0, 0);
      out[id] = c.toDataURL('image/png');
    }
    r.setRenderTarget(null);
    r.toneMapping = prevTM;
    this.scene.background = prevBg; this.scene.fog = prevFog;
    rt.dispose(); rtOut.dispose(); outPass.dispose();
    return out;
  }
}
