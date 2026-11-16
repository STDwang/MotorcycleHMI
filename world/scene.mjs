import * as THREE from '../vendor/three.module.js';
import { createBike } from './bike.mjs';

const UP = new THREE.Vector3(0, 1, 0);
export class RideWorld {
  constructor(canvas, track, clusterCanvas) {
    this.track = track; this.clusterCanvas = clusterCanvas; this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.FogExp2(0xb5c9cc, .0015);
    this.camera = new THREE.PerspectiveCamera(58, 1, .08, 2300); this.cameraMode = 'chase'; this.quality = 'high'; this.slowTime = 0; this.reducedMotion = false;
    this.sun = new THREE.DirectionalLight(0xffe4bc, 3.2); this.sun.position.set(-350, 600, -180); this.scene.add(this.sun);
    this.sky = new THREE.HemisphereLight(0xbfd9ed, 0x343e24, 2.3); this.scene.add(this.sky);
    this.materials = {}; this.makeCircuit(); this.batchSurfaces(); this.makeScenery(); this.bikes = []; this.rain = this.makeRain();
    this.lights = []; this.makeGantry();
    this.headlight = new THREE.SpotLight(0xc7e7ff, 0, 160, .42, .6, 1); this.scene.add(this.headlight, this.headlight.target);
    this.cameraPosition = new THREE.Vector3(); this.aim = new THREE.Vector3(); this.started = false;
    this.target = new THREE.WebGLRenderTarget(1, 1);
    this.postScene = new THREE.Scene(); this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.post = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { image: { value: this.target.texture }, texel: { value: new THREE.Vector2(1, 1) }, speed: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D image; uniform vec2 texel; uniform float speed; varying vec2 vUv;
        void main(){ vec2 d=vUv-vec2(.5); vec3 color=texture2D(image,vUv).rgb; vec3 blur=vec3(0.); vec3 glow=vec3(0.);
          for(int i=1;i<=4;i++){float f=float(i); blur+=texture2D(image,vUv-d*f*.002*speed).rgb;
            glow+=max(vec3(0.),texture2D(image,vUv+texel*vec2(f*2.,f)).rgb-.8);
            glow+=max(vec3(0.),texture2D(image,vUv-texel*vec2(f,f*2.)).rgb-.8);}
          color=mix(color,blur*.25,clamp(length(d)*speed*.18,0.,.22)); color+=glow*.035;
          color*=1.-smoothstep(.25,.75,length(d))*.12; gl_FragColor=vec4(color,1.);
          #include <colorspace_fragment>
        }` });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.resize(); this.setEnvironment('clear');
    this.resizeHandler = () => this.resize(); addEventListener('resize', this.resizeHandler);
  }
  material(name, color, roughness = .9) { return this.materials[name] = new THREE.MeshStandardMaterial({ color, roughness, metalness: .02 }); }
  strip(from, to, material, height = 0, start = 0, end = this.track.length, spacing = 4) {
    const positions = [], indices = [], track = this.track, count = Math.ceil((end - start) / spacing);
    for (let i = 0; i <= count; i++) {
      const s = start + (end - start) * i / count;
      for (const d of [typeof from === 'function' ? from(s) : from, typeof to === 'function' ? to(s) : to]) {
        const f = track.frame(s, d); positions.push(f.x, f.y + height, f.z);
      }
      if (i < count) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals();
    material.side = THREE.DoubleSide; const mesh = new THREE.Mesh(g, material); mesh.userData.surface = true; this.scene.add(mesh); return mesh;
  }
  batchSurfaces() {
    const groups = new Map();
    for (const mesh of [...this.scene.children]) if (mesh.userData.surface && mesh !== this.line) {
      const group = groups.get(mesh.material) ?? []; group.push(mesh); groups.set(mesh.material, group);
    }
    for (const [material, meshes] of groups) {
      if (meshes.length < 2) continue;
      const positions = [], normals = [], indices = []; let offset = 0;
      for (const mesh of meshes) {
        const g = mesh.geometry; positions.push(...g.attributes.position.array); normals.push(...g.attributes.normal.array);
        for (const index of g.index.array) indices.push(index + offset); offset += g.attributes.position.count;
        this.scene.remove(mesh); g.dispose();
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(indices); this.scene.add(new THREE.Mesh(geometry, material));
    }
  }
  makeCircuit() {
    const hw = this.track.halfWidth;
    this.strip(-hw - 28, hw + 28, this.material('grass', 0x647751), -.16);
    this.strip(-hw - 10, hw + 10, this.material('runoff', 0x807e69), -.08);
    this.asphalt = this.material('asphalt', 0x303a3f, .88); this.strip(-hw, hw, this.asphalt);
    const white = this.material('white', 0xe7e6de), red = this.material('red', 0xca3e38);
    for (const sign of [-1, 1]) {
      this.strip(sign * (hw - .17), sign * (hw - .03), white, .015);
      for (let s = 0; s < this.track.length; s += 8) this.strip(sign * hw, sign * (hw + 1.05), Math.floor(s / 8) % 2 ? white : red, .025, s, Math.min(s + 8, this.track.length), 4);
      const rail = this.material('rail' + sign, 0xaab5b4, .36);
      this.strip(s => sign * this.track.barrier(s), s => sign * (this.track.barrier(s) + .3), rail, .85);
    }
    const green = new THREE.MeshBasicMaterial({ color: 0x92ed77, transparent: true, opacity: .5, depthWrite: false });
    this.line = this.strip(s => this.track.at(this.track.lineD, s) - .16, s => this.track.at(this.track.lineD, s) + .16, green, .04);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 16; col++) this.strip(-hw + col * hw / 8, -hw + (col + 1) * hw / 8, (row + col) % 2 ? white : this.asphalt, .035, row * .7, (row + 1) * .7, 1);
    // Tunnel sides and roof follow the same elevated track frame as the road.
    const concrete = this.material('tunnel', 0x58626a), [a, b] = this.track.tunnel;
    this.strip(-8, 8, concrete, 6, a, b);
    const wall = side => {
      const points = [], idx = [], n = Math.ceil((b - a) / 5);
      for (let i = 0; i <= n; i++) { const f = this.track.frame(a + (b - a) * i / n, side * 7.8); points.push(f.x, f.y, f.z, f.x, f.y + 6, f.z); if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setIndex(idx); g.computeVertexNormals(); this.scene.add(new THREE.Mesh(g, concrete));
    }; wall(-1); wall(1);
    const lamp = new THREE.MeshBasicMaterial({ color: 0xd9ecf0 });
    for (let s = a; s < b; s += 14) for (const d of [-6.8, 6.8]) { const f = this.track.frame(s, d); this.box(f.x, f.y + 4, f.z, .2, .2, 2.4, lamp); }
  }
  box(x, y, z, sx, sy, sz, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); this.scene.add(m); return m; }
  makeScenery() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4500, 4500, 40, 40), this.material('ground', 0x4c6450)); ground.rotation.x = -Math.PI / 2; ground.position.y = -5; this.scene.add(ground);
    let seed = 240; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const treeGeo = new THREE.ConeGeometry(2.7, 12, 6), treeMat = this.material('trees', 0x214c40), dummy = new THREE.Object3D();
    const trees = this.trees = new THREE.InstancedMesh(treeGeo, treeMat, 700);
    let count = 0;
    while (count < 700) {
      const x = (rand() - .5) * 1700, z = (rand() - .5) * 1550, near = this.track.locate(x, z, 20);
      if (near.distance < 34) continue;
      const scale = .6 + rand() * 1.2; dummy.position.set(x, 3 + scale * 4, z); dummy.scale.set(scale, scale, scale); dummy.rotation.y = rand() * 6.28; dummy.updateMatrix(); trees.setMatrixAt(count++, dummy.matrix);
    }
    this.scene.add(trees);
    const mountain = this.material('mountain', 0x5f797b);
    for (let i = 0; i < 28; i++) {
      const r = 1100 + rand() * 350, angle = i / 28 * Math.PI * 2, height = 120 + rand() * 290;
      const m = new THREE.Mesh(new THREE.ConeGeometry(250 + rand() * 230, height, 6), mountain); m.position.set(Math.sin(angle) * r, height / 2 - 20, Math.cos(angle) * r); this.scene.add(m);
    }
    const stand = this.material('stand', 0x536778), roof = this.material('roof', 0xdce3dc);
    for (let i = 0; i < 5; i++) { const f = this.track.frame(120 + i * 38, -39); const m = this.box(f.x, f.y + 2, f.z, 32, 5, 15, stand); m.rotation.y = -Math.atan2(f.tz, f.tx); const r = this.box(f.x, f.y + 9, f.z, 34, .4, 18, roof); r.rotation.y = m.rotation.y; }
    const labelCanvas = document.createElement('canvas'); labelCanvas.width = 512; labelCanvas.height = 96;
    const c = labelCanvas.getContext('2d'); c.fillStyle = '#142433'; c.fillRect(0, 0, 512, 96); c.fillStyle = '#eaff58'; c.font = 'italic 800 55px Arial'; c.fillText('APEX  /  MOTO', 28, 67);
    const texture = new THREE.CanvasTexture(labelCanvas); texture.colorSpace = THREE.SRGBColorSpace;
    const ads = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    for (let i = 0; i < 24; i++) { const f = this.track.frame(i / 24 * this.track.length, 19); const mesh = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.45), ads); mesh.position.set(f.x, f.y + 2.5, f.z); mesh.rotation.y = Math.atan2(-f.rx, -f.rz); this.scene.add(mesh); }
  }
  makeGantry() {
    const frame = this.track.frame(5), group = new THREE.Group(); group.position.set(frame.x, frame.y, frame.z); group.rotation.y = Math.atan2(frame.tx, frame.tz); this.scene.add(group);
    const material = this.material('gantry', 0x26333e);
    for (const x of [-9, 9]) { const m = new THREE.Mesh(new THREE.BoxGeometry(.5, 8, .5), material); m.position.set(x, 4, 0); group.add(m); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(18.5, 1.2, .6), material); bar.position.y = 7.4; group.add(bar);
    for (let i = 0; i < 5; i++) { const mat = new THREE.MeshBasicMaterial({ color: 0x341819 }); const m = new THREE.Mesh(new THREE.SphereGeometry(.31, 12, 8), mat); m.position.set(-2.4 + i * 1.2, 7.4, -.38); group.add(m); this.lights.push(mat); }
  }
  makeRain() {
    const pos = new Float32Array(1500 * 3); for (let i = 0; i < 1500; i++) { pos[i * 3] = (i * 13.31 % 70) - 35; pos[i * 3 + 1] = (i * 7.13 % 35); pos[i * 3 + 2] = (i * 11.23 % 70) - 35; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rain = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xc4dce9, size: .06, transparent: true, opacity: .55 })); rain.frustumCulled = false; this.scene.add(rain); return rain;
  }
  setEntries(entries) {
    // Models are reused by livery across restarts; no geometry or texture allocations per restart.
    this.bikePool ??= new Map();
    for (const bike of this.bikes) this.scene.remove(bike.root);
    this.bikes = entries.map(e => { if (!this.bikePool.has(e.livery)) this.bikePool.set(e.livery, createBike(e.livery, e.player ? this.clusterCanvas : null)); const bike = this.bikePool.get(e.livery); this.scene.add(bike.root); return bike; });
    this.started = false;
  }
  setEnvironment(name) {
    this.environment = name; const night = name === 'rain', dusk = name === 'dusk';
    this.scene.background = new THREE.Color(night ? 0x081421 : dusk ? 0xbe9082 : 0xaac9df);
    this.scene.fog.color.copy(this.scene.background); this.scene.fog.density = night ? .003 : .0013;
    this.sun.color.set(dusk ? 0xff9e63 : 0xffe4bc); this.sun.intensity = night ? .3 : dusk ? 1.9 : 3.2;
    this.sky.intensity = night ? .85 : dusk ? 1.7 : 2.3;
    this.asphalt.roughness = night ? .21 : .88; this.asphalt.metalness = night ? .5 : .02;
    this.rain.visible = night; this.canvas.closest('main')?.classList.toggle('rainy', night);
  }
  setQuality(name) { this.quality = name; this.renderer.setPixelRatio(Math.min(devicePixelRatio, name === 'low' ? .8 : name === 'medium' ? 1.15 : 1.6)); this.trees.count = name === 'low' ? 260 : name === 'medium' ? 460 : 700; this.resize(); }
  resize() { const rect = this.canvas.getBoundingClientRect(); this.renderer.setSize(rect.width, rect.height, false); this.camera.aspect = rect.width / Math.max(1, rect.height); this.camera.updateProjectionMatrix();
    if (this.target) { const size = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.target.setSize(size.x, size.y); this.post.uniforms.texel.value.set(1 / size.x, 1 / size.y); }
  }
  update(poses, session, dt, time) {
    for (let i = 0; i < poses.length; i++) this.bikes[i].update(poses[i], this.track, dt);
    const pose = poses.at(-1), f = this.track.frame(pose.s, pose.d), forward = new THREE.Vector3(f.tx, f.slope, f.tz).normalize(), right = new THREE.Vector3(f.rx, 0, f.rz), origin = new THREE.Vector3(f.x, f.y, f.z);
    const mode = session.mode === 'demo' ? (Math.floor(time / 10) % 3 === 0 ? 'cinema' : 'chase') : this.cameraMode;
    const pos = origin.clone(), target = origin.clone();
    if (mode === 'cockpit' || mode === 'cluster') {
      const player = this.bikes.at(-1); player.root.updateMatrixWorld(true);
      pos.copy(player.lean.localToWorld(new THREE.Vector3(0, mode === 'cluster' ? 1.55 : 1.64, mode === 'cluster' ? -.05 : -.12)));
      target.copy(player.lean.localToWorld(new THREE.Vector3(0, mode === 'cluster' ? 1.23 : 1.48, mode === 'cluster' ? .36 : 18)));
    }
    else if (mode === 'cinema') { pos.addScaledVector(forward, -7).addScaledVector(right, this.reducedMotion ? 0 : 7 * Math.sin(time * .08)).addScaledVector(UP, 3.5); target.addScaledVector(forward, 5).addScaledVector(UP, 1); }
    else { pos.addScaledVector(forward, -4.6 - pose.speed * .012).addScaledVector(UP, 2.1); target.addScaledVector(forward, 8).addScaledVector(UP, .7); }
    // Interpolated poses already remove fixed-step judder. World-space camera damping at 280 km/h
    // would leave the cockpit several metres behind the motorcycle.
    const k = this.started && mode === 'cinema' ? 1 - Math.exp(-dt * 12) : 1;
    this.cameraPosition.lerp(pos, k); this.aim.lerp(target, k); this.started = true;
    this.camera.position.copy(this.cameraPosition); this.camera.up.set(0, 1, 0);
    if (!this.reducedMotion && (mode === 'cockpit' || mode === 'cluster')) { this.camera.up.set(-Math.sin(pose.lean) * .7 * Math.cos(Math.atan2(f.tx, f.tz)), Math.cos(pose.lean * .7), Math.sin(pose.lean) * .7 * Math.sin(Math.atan2(f.tx, f.tz))).normalize(); }
    this.camera.lookAt(this.aim);
    if (!this.reducedMotion && mode === 'chase') this.camera.rotateZ(-pose.lean * .12);
    this.camera.fov = mode === 'cluster' ? 48 : this.reducedMotion ? 54 : 54 + Math.min(15, pose.speed * .19); this.camera.updateProjectionMatrix();
    this.bikes.at(-1).rider.visible = mode !== 'cockpit' && mode !== 'cluster';
    this.lights.forEach((mat, i) => mat.color.set(session.race.lights > i ? 0xff2017 : 0x341819));
    const tunnel = this.track.tunnelWeight(pose.s, 8); this.headlight.intensity = this.environment === 'rain' || tunnel > .1 ? 60 : 0;
    this.headlight.position.copy(origin).addScaledVector(UP, .8); this.headlight.target.position.copy(origin).addScaledVector(forward, 30);
    this.line.visible = session.assist !== 'pro' && session.mode !== 'bench';
    const v = session.hmi.view; this.line.material.color.set(!v.speed.valid ? 0x7d9298 : v.speed.value > v.nav.advise + 12 ? 0xff4837 : v.speed.value > v.nav.advise ? 0xffcd43 : 0x91ef76);
    if (this.rain.visible) {
      this.rain.position.copy(origin); const attr = this.rain.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) { let y = attr.getY(i) - dt * 23; if (y < 0) y += 35; attr.setY(i, y); } attr.needsUpdate = true;
    }
    if (this.quality === 'low') this.renderer.render(this.scene, this.camera);
    else {
      this.renderer.setRenderTarget(this.target); this.renderer.render(this.scene, this.camera); this.renderer.setRenderTarget(null);
      this.post.uniforms.speed.value = this.reducedMotion ? 0 : Math.max(0, (pose.speed - 25) / 40); this.renderer.render(this.postScene, this.postCamera);
    }
  }
}
