// Renderer, camera, lights, environment and post-processing.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

export const QUALITY = {
  low: { dpr: 1, minDpr: 0.6, shadow: 1024, bloom: false, aa: 'none', marks: 1024, post: false, terrainStep: 2 },
  medium: { dpr: 1.5, minDpr: 0.7, shadow: 2048, bloom: true, aa: 'fxaa', marks: 2048, post: true, terrainStep: 2 },
  high: { dpr: 1.75, minDpr: 0.85, shadow: 4096, bloom: true, aa: 'smaa', marks: 2048, post: true, terrainStep: 2 },
};

export const TIMES = {
  day: {
    sunDir: [-0.74, 0.6, 0.2], sun: 0xfff1dc, sunI: 3.6, hemiSky: 0xbcd6ff, hemiGround: 0x8a5a3a, hemiI: 1.05,
    skyTop: 0x2f6fc4, skyHorizon: 0xcfe2f2, fog: 0xc9d8e2, exposure: 1.0, envI: 0.9,
  },
  sunset: {
    sunDir: [-0.88, 0.36, -0.02], sun: 0xffb36b, sunI: 3.3, hemiSky: 0x8fa6d8, hemiGround: 0x7a4630, hemiI: 0.9,
    skyTop: 0x34407a, skyHorizon: 0xf2a76a, fog: 0xd9a58a, exposure: 1.05, envI: 0.8,
  },
  night: {
    sunDir: [-0.38, 0.86, -0.34], sun: 0xe6eeff, sunI: 2.1, hemiSky: 0x33405e, hemiGround: 0x2a1e1a, hemiI: 0.35,
    skyTop: 0x03050b, skyHorizon: 0x121a30, fog: 0x0e121c, exposure: 1.1, envI: 0.3, spots: true,
  },
};

const VignetteGrade = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uTime: { value: 0 },
    uGrain: { value: 0.025 },
    uSat: { value: 1.14 },
    uContrast: { value: 1.06 },
    uWarm: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uTime; uniform float uGrain; uniform float uSat; uniform float uContrast; uniform vec3 uWarm;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uWarm;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      // gentle contrast around mid grey (scene-referred values)
      col = max(vec3(0.0), (col - 0.18) * uContrast + 0.18);
      vec2 d = vUv - 0.5; d.x *= 1.3;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.9, dot(d, d) * 2.2);
      col += (h(vUv * 1000.0 + uTime) - 0.5) * uGrain * (0.6 + l);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Scene3D {
  constructor(container, quality = 'high') {
    this.container = container;
    this.q = QUALITY[quality] || QUALITY.high;
    this.qualityName = quality;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: !!window.__keepBuffer }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);
    this.ftAvg = 16; this.dynT = 0;
    container.appendChild(r.domElement);
    r.domElement.id = 'gl';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 16 / 9, 5, 900);
    this.clock = 0;

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd6ff, 0x8a5a3a, 1);
    this.scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(r);
    this._setupPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _setupPost() {
    const r = this.renderer, q = this.q;
    if (!q.post) { this.composer = null; return; }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.42, 1.6);
      // cap what feeds the bloom: a single blown-out specular pixel (glossy paint
      // under a spotlight) would otherwise bloom into a big white blob
      const hp = this.bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
        'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\ttexel.rgb *= min( 1.0, 6.0 / max( luminance( texel.rgb ), 1e-4 ) );');
      hp.needsUpdate = true;
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(VignetteGrade);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (q.aa === 'smaa') this.composer.addPass(new SMAAPass());
    else if (q.aa === 'fxaa') this.composer.addPass(new FXAAPass());
  }

  setTime(name) {
    const t = TIMES[name] || TIMES.day;
    this.time = t;
    const d = new THREE.Vector3(...t.sunDir).normalize();
    this.sunDir = d;
    this.sun.color.set(t.sun);
    this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiI;
    this.renderer.toneMappingExposure = t.exposure;
    this.scene.fog = new THREE.Fog(t.fog, 220, 700);
    this._buildEnv(t);
    this._placeSun();
    this._spots(!!t.spots && this.qualityName !== 'low');
  }

  // floodlights from the four towers (night only, no shadows)
  _spots(on) {
    if (!this.spotLights) {
      this.spotLights = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const l = new THREE.SpotLight(0xfff1d8, 0, 0, 0.62, 0.75, 2.0);
        l.position.set(sx * 102, 46, sz * 76);
        l.target.position.set(sx * 18, 0, sz * 10);
        l.castShadow = false;
        this.scene.add(l, l.target);
        this.spotLights.push(l);
      }
    }
    for (const l of this.spotLights) { l.intensity = on ? 7500 : 0; l.visible = on; }
  }

  _placeSun() {
    const d = this.sunDir;
    const target = new THREE.Vector3(0, 0, 0);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(d, 150);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    // fit the shadow camera around the stadium floor + low stands
    const cam = this.sun.shadow.camera;
    const m = new THREE.Matrix4().lookAt(this.sun.position, target, new THREE.Vector3(0, 1, 0));
    const inv = m.clone().invert();
    const pts = [];
    for (const x of [-80, 80]) for (const z of [-56, 56]) for (const y of [-2, 14]) pts.push(new THREE.Vector3(x, y, z));
    const box = new THREE.Box3();
    for (const p of pts) box.expandByPoint(p.clone().sub(this.sun.position).applyMatrix4(inv));
    cam.left = box.min.x; cam.right = box.max.x; cam.bottom = box.min.y; cam.top = box.max.y;
    cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
  }

  _buildEnv(t) {
    const env = new THREE.Scene();
    const geo = new THREE.SphereGeometry(100, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(t.skyTop) }, hor: { value: new THREE.Color(t.skyHorizon) },
        ground: { value: new THREE.Color(t.hemiGround).multiplyScalar(0.6) }, sunDir: { value: new THREE.Vector3(...t.sunDir).normalize() },
        sunCol: { value: new THREE.Color(t.sun) },
      },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top, hor, ground, sunDir, sunCol; varying vec3 vD;
        void main(){
          float y = vD.y;
          vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y, 0.0, 1.0), 0.6)) : mix(hor * 0.7, ground, clamp(-y * 4.0, 0.0, 1.0));
          float s = max(0.0, dot(vD, sunDir));
          c += sunCol * (pow(s, 600.0) * 30.0 + pow(s, 12.0) * 0.35);
          // stadium rim: dark band with bright light rigs just above the horizon
          float band = smoothstep(0.02, 0.06, y) * smoothstep(0.24, 0.18, y);
          c = mix(c, c * 0.35, band * 0.8);
          float az = atan(vD.z, vD.x);
          float rigs = smoothstep(0.85, 1.0, sin(az * 9.0)) * smoothstep(0.17, 0.2, y) * smoothstep(0.26, 0.22, y);
          c += vec3(1.0, 0.95, 0.85) * rigs * 3.0;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    env.add(new THREE.Mesh(geo, mat));
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(env, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = t.envI;
    this.scene.background = new THREE.Color(t.skyHorizon).multiplyScalar(0.5);
    geo.dispose(); mat.dispose();
    this._sky(t);
  }

  // visible sky dome with drifting clouds (seen by the low intro / podium cameras)
  _sky(t) {
    if (!this.skyMesh) {
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() },
          uTime: { value: 0 }, uNight: { value: 0 } },
        vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
        fragmentShader: `uniform vec3 top, hor, sunDir, sunCol; uniform float uTime, uNight; varying vec3 vD;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p *= 2.07; a *= 0.5; } return s; }
          void main(){
            vec3 d = normalize(vD);
            float y = max(d.y, 0.0);
            vec3 c = mix(hor, top, pow(y, 0.55));
            float s = max(0.0, dot(d, sunDir));
            c += sunCol * (pow(s, 900.0) * 18.0 + pow(s, 14.0) * 0.25 * (1.0 - uNight));
            // clouds on a plane above
            vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.01, 0.0);
            float cl = smoothstep(0.52, 0.85, fbm(uv));
            vec3 cc = mix(vec3(1.0, 0.97, 0.94), hor * 1.1, 0.35) * (1.0 - 0.75 * uNight);
            c = mix(c, cc, cl * smoothstep(0.02, 0.2, y) * 0.85);
            // stars at night
            float st = step(0.9985, h(floor(d.xz / (d.y + 0.2) * 260.0))) * uNight * smoothstep(0.1, 0.4, y);
            c += vec3(st);
            if (d.y < 0.0) c = hor * 0.6;
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
      this.skyMesh.renderOrder = -10;
      this.skyMesh.frustumCulled = false;
      this.scene.add(this.skyMesh);
    }
    const u = this.skyMesh.material.uniforms;
    u.top.value.set(t.skyTop); u.hor.value.set(t.skyHorizon);
    u.sunDir.value.set(...t.sunDir).normalize(); u.sunCol.value.set(t.sun);
    u.uNight.value = t === TIMES.night ? 1 : 0;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.activeCamera && this.activeCamera !== this.camera) { this.activeCamera.aspect = w / h; this.activeCamera.updateProjectionMatrix(); }
    if (this.composer) {
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(w, h);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      if (this.bloom) this.bloom.setSize(s.x / 2, s.y / 2);
    }
    if (this.onResize) this.onResize(w, h);
  }

  // place the camera so that the given box (x0,z0,x1,z1) fills the view
  // topInset: fraction of the screen height kept free at the top for the HUD board
  fitClassic(box, pitchDeg = 58, margin = 0.96, yTop = 1.5, topInset = 0) {
    const cam = this.camera;
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const dir = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
    const pts = [];
    for (const x of [box[0], box[2]]) for (const z of [box[1], box[3]]) for (const y of [0, yTop]) pts.push(new THREE.Vector3(x, y, z));
    const target = new THREE.Vector3((box[0] + box[2]) / 2, 0, (box[1] + box[3]) / 2);
    const fits = (dist) => {
      cam.position.copy(target).addScaledVector(dir, -dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of pts) {
        const v = p.clone().project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      return { x0, x1, y0, y1 };
    };
    let dist = 150;
    for (let it = 0; it < 6; it++) {
      let lo = 20, hi = 600;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        const e = fits(mid);
        if (e.x0 >= -margin && e.x1 <= margin && e.y0 >= -margin && e.y1 <= margin - 2 * topInset) hi = mid; else lo = mid;
      }
      dist = hi;
      const e = fits(dist);
      // recentre vertically (in the space below the HUD) by moving the target along the ground
      const cy = (e.y0 + e.y1) / 2 + topInset;
      target.z -= cy * 12 / (it + 1);
    }
    fits(dist);
    this.classic = { pos: cam.position.clone(), target: target.clone(), fov: cam.fov };
    return this.classic;
  }

  // switch what is drawn (the stadium or the garage)
  setActive(scene, camera) {
    if (!this.mainScene) { this.mainScene = this.scene; this.mainCamera = this.camera; }
    const sc = scene || this.mainScene, cam = camera || this.mainCamera;
    this.activeScene = sc; this.activeCamera = cam;
    if (this.renderPass) { this.renderPass.scene = sc; this.renderPass.camera = cam; }
    cam.aspect = this.camera.aspect; cam.updateProjectionMatrix();
  }

  // dynamic resolution: keep the frame time under budget
  _dynamicRes(dt) {
    if (!this.dynamic) return;
    this.ftAvg += (dt * 1000 - this.ftAvg) * 0.05;
    this.dynT += dt;
    if (this.dynT < 1.5) return;
    let d = this.dpr;
    if (this.ftAvg > 21 && d > this.q.minDpr) d = Math.max(this.q.minDpr, d - 0.12);
    else if (this.ftAvg < 14.5 && d < this.maxDpr) d = Math.min(this.maxDpr, d + 0.08);
    if (d !== this.dpr) {
      this.dpr = d;
      this.renderer.setPixelRatio(d);
      this.resize();
      this.dynT = 0;
    } else this.dynT = 1.0;
  }

  render(dt) {
    this.clock += dt;
    this._dynamicRes(dt);
    if (this.skyMesh) { this.skyMesh.material.uniforms.uTime.value = this.clock; this.skyMesh.position.copy(this.camera.position); }
    if (this.composer) {
      if (this.grade) this.grade.uniforms.uTime.value = (this.clock * 60) % 1000;
      this.composer.render(dt);
    } else this.renderer.render(this.activeScene || this.scene, this.activeCamera || this.camera);
  }
}
