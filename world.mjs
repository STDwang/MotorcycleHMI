import * as THREE from './vendor/three.module.js';
import { obstacles } from './ride.mjs';

const UP = new THREE.Vector3(0, 1, 0);
function rng(seed = 93281) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
const random = rng();
const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .9, ...extra });

export class RideWorld {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.25 : 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#b9d8dc');
    this.scene.fog = new THREE.FogExp2('#c5d9d6', .00165);
    this.camera = new THREE.PerspectiveCamera(66, 1, .08, 2400);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#d7efff', '#414d2f', 2.4));
    this.sun = new THREE.DirectionalLight('#ffe0a5', 3.4); this.sun.position.set(-350, 450, -250); this.scene.add(this.sun);
    this.track = this.createTrack(); this.length = this.track.getLength();
    this.samples = Array.from({ length: 401 }, (_, i) => this.track.getPointAt(i / 400));
    this.createSky(); this.createTerrain(); this.createRoad(); this.createForest();
    this.createDetails(); this.createBike();
    this.resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      this.renderer.setSize(width, height, false); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
    };
    this.resize(); addEventListener('resize', this.resize);
    this.lastLean = 0; this.quality = 'high'; this.rendered = 0;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); dispatchEvent(new CustomEvent('world-context-lost')); });
  }
  createTrack() {
    const points = [];
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2;
      const radius = 455 + Math.sin(angle * 3) * 65 + Math.cos(angle * 5) * 22;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 21 + Math.sin(angle * 2 + .3) * 13 + Math.cos(angle * 3) * 5, Math.sin(angle) * radius * .9));
    }
    return new THREE.CatmullRomCurve3(points, true, 'centripetal');
  }
  frame(distance, lateral = 0) {
    const t = ((distance / this.length) % 1 + 1) % 1;
    const point = this.track.getPointAt(t), tangent = this.track.getTangentAt(t).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    point.addScaledVector(right, lateral);
    return { point, tangent, right, t };
  }
  closest(x, z) {
    let nearest = this.samples[0], min = Infinity;
    for (let i = 0; i < this.samples.length; i += 2) {
      const p = this.samples[i], d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < min) { min = d; nearest = p; }
    }
    return { distance: Math.sqrt(min), point: nearest };
  }
  ground(x, z) {
    const { distance, point } = this.closest(x, z);
    const radius = Math.hypot(x, z / .9);
    const mountain = 28 + Math.sin(x * .008 + z * .003) * 24 + Math.cos(z * .012) * 15 + Math.max(0, radius - 500) * .26;
    const base = radius < 330 ? -9 + radius * .025 : mountain;
    const blend = THREE.MathUtils.smoothstep(distance, 10, 110);
    return THREE.MathUtils.lerp(point.y - .8, base, blend);
  }
  createSky() {
    // Gradient sky and sun are shader/math generated, with no skybox images.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 p; void main(){p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec3 p; void main(){float h=normalize(p).y; vec3 c=mix(vec3(.88,.86,.72),vec3(.38,.66,.77),smoothstep(-.05,.7,h)); float sun=pow(max(0.,dot(normalize(p),normalize(vec3(-.65,.45,-.4)))),320.); c+=vec3(1.,.7,.3)*sun*1.4; gl_FragColor=vec4(c,1.);}',
    }));
    this.scene.add(sky);
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#eef0df', transparent: true, opacity: .48, depthWrite: false });
    const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 5), cloudMat, 28);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 28; i++) {
      const a = random() * Math.PI * 2, radius = 650 + random() * 800;
      dummy.position.set(Math.cos(a) * radius, 210 + random() * 160, Math.sin(a) * radius);
      dummy.scale.set(65 + random() * 90, 7 + random() * 12, 30 + random() * 45); dummy.updateMatrix(); clouds.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(clouds);
    const mountains = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), material('#758d8c', { flatShading: true }), 25);
    for (let i = 0; i < 25; i++) {
      const a = i / 25 * Math.PI * 2, height = 250 + random() * 330;
      dummy.position.set(Math.cos(a) * 1160, height * .5 - 40, Math.sin(a) * 1160);
      dummy.scale.set(220 + random() * 180, height, 190 + random() * 100); dummy.rotation.y = random() * 3; dummy.updateMatrix(); mountains.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(mountains);
  }
  createTerrain() {
    const geometry = new THREE.PlaneGeometry(2350, 2350, 150, 150); geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position, colors = [];
    const grass = new THREE.Color('#6d8251'), rock = new THREE.Color('#8e9678'), shore = new THREE.Color('#aaad80');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), y = this.ground(x, z);
      positions.setY(i, y);
      const c = grass.clone().lerp(y < 4 ? shore : rock, y < 4 ? .7 : Math.max(0, Math.min(.7, (y - 30) / 120)));
      c.multiplyScalar(.93 + random() * .14); colors.push(c.r, c.g, c.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geometry, material('#ffffff', { vertexColors: true, flatShading: true })));
    const waterGeometry = new THREE.CircleGeometry(325, 80); waterGeometry.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeometry, new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } }, transparent: true,
      vertexShader: 'varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 p;uniform float time;void main(){float a=sin(p.x*.17+time*.35)*sin(p.z*.19-time*.22);float b=pow(max(0.,sin(p.x*.8+p.z*.6+time)),20.);vec3 c=mix(vec3(.12,.38,.37),vec3(.37,.64,.61),.5+a*.12);c+=b*.06;gl_FragColor=vec4(c,.95);}',
    }));
    this.water.position.y = .4; this.water.scale.z = .9; this.scene.add(this.water);
  }
  asphalt() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'), data = ctx.createImageData(128, 128);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = 70 + random() * 23; data.data[i] = v; data.data[i + 1] = v + 2; data.data[i + 2] = v; data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    return texture;
  }
  ribbon(left, right, height, mat, start = 0, end = 1, steps = 900) {
    const vertices = [], uv = [], indices = [];
    for (let i = 0; i <= steps; i++) {
      const fraction = start + (end - start) * i / steps;
      const { point, right: axis } = this.frame(fraction * this.length);
      for (const offset of [left, right]) {
        vertices.push(point.x + axis.x * offset, point.y + height, point.z + axis.z * offset);
        uv.push(offset / 5, fraction * this.length / 8);
      }
      if (i < steps) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, mat); this.scene.add(mesh); return mesh;
  }
  createRoad() {
    this.ribbon(-4.7, 4.7, .02, material('#aba98f'), 0, 1);
    this.ribbon(-3.7, 3.7, .08, material('#b3b4aa', { map: this.asphalt(), roughness: 1 }), 0, 1);
    const white = material('#f3ecce'), yellow = material('#e8c46e');
    this.ribbon(-3.45, -3.32, .10, white); this.ribbon(3.32, 3.45, .10, white);
    // Single buffer for dashed center lines.
    const vertices = [], indices = [];
    for (let distance = 0; distance < this.length; distance += 12) {
      const index = vertices.length / 3;
      for (const d of [distance, distance + 4]) for (const offset of [-.065, .065]) {
        const { point } = this.frame(d, offset); vertices.push(point.x, point.y + .12, point.z);
      }
      indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
    }
    const lines = new THREE.BufferGeometry(); lines.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); lines.setIndex(indices); lines.computeVertexNormals(); this.scene.add(new THREE.Mesh(lines, yellow));
    const postMat = material('#d6dbce', { metalness: .6, roughness: .4 });
    const count = Math.floor(this.length / 8) * 2;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, .8, .12), postMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count / 2; i++) for (const side of [-1, 1]) {
      const { point } = this.frame(i * 8, side * 4.4); dummy.position.copy(point); dummy.position.y += .45; dummy.updateMatrix(); posts.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), dummy.matrix);
    }
    this.scene.add(posts);
    this.ribbon(-4.45, -4.33, .9, postMat); this.ribbon(4.33, 4.45, .9, postMat);
  }
  createForest() {
    const placements = [];
    for (let i = 0; i < 2000; i++) {
      const d = random() * this.length, side = random() > .5 ? 1 : -1;
      const { point } = this.frame(d, side * (17 + random() ** 1.5 * 230));
      const y = this.ground(point.x, point.z);
      if (y < 2 || this.closest(point.x, point.z).distance < 12) continue;
      placements.push({ x: point.x, y, z: point.z, scale: .75 + random() * 1.2 });
    }
    const count = placements.length, dummy = new THREE.Object3D();
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.23, .4, 4, 5), material('#655d44'), count);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.5, 8, 7), material('#325b45', { flatShading: true }), count);
    const tops = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 6, 7), material('#456b4d', { flatShading: true }), count);
    const color = new THREE.Color();
    placements.forEach((p, i) => {
      dummy.scale.setScalar(p.scale); dummy.position.set(p.x, p.y + 2 * p.scale, p.z); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = p.y + 6 * p.scale; dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
      dummy.position.y = p.y + 9 * p.scale; dummy.updateMatrix(); tops.setMatrixAt(i, dummy.matrix);
      color.setHSL(.30 + random() * .06, .2 + random() * .13, .72 + random() * .15); crowns.setColorAt(i, color); tops.setColorAt(i, color);
    });
    this.scene.add(trunks, crowns, tops); this.forest = [trunks, crowns, tops];
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), material('#929482', { flatShading: true }), 200);
    for (let i = 0; i < 200; i++) {
      const { point } = this.frame(random() * this.length, (random() > .5 ? 1 : -1) * (12 + random() * 160));
      dummy.position.set(point.x, this.ground(point.x, point.z) + .8, point.z);
      dummy.scale.set(1 + random() * 4, .8 + random() * 4, 1 + random() * 3); dummy.rotation.set(random(), random() * 6, random()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(rocks);
  }
  createDetails() {
    const dark = material('#243e3b'), lime = material('#d0ef80', { emissive: '#719242', emissiveIntensity: .12 });
    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group(), frame = this.frame(i / 4 * this.length + 8);
      for (const x of [-4.8, 4.8]) { const post = new THREE.Mesh(new THREE.BoxGeometry(.25, 6.5, .3), dark); post.position.set(x, 3.25, 0); group.add(post); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(10, .55, .45), i === 0 ? lime : dark); bar.position.y = 6.4; group.add(bar);
      const sign = this.sign(i === 0 ? 'APEX / START' : `SECTOR 0${i}`, 6, .75, '#d2ed91'); sign.position.set(0, 6.4, -.28); group.add(sign);
      group.position.copy(frame.point); group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z); this.scene.add(group);
    }
    const coneMat = material('#ed8b47'), stripe = material('#f4ebd6');
    for (const obstacle of obstacles) {
      const { point } = this.frame(obstacle.fraction * this.length + 8, obstacle.lane);
      const group = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(.85, .08, .85), dark); base.position.y = .12;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(.32, 1.2, 8), coneMat); cone.position.y = .75;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(.16, .21, .22, 8), stripe); band.position.y = .89;
      group.add(base, cone, band); group.position.copy(point); this.scene.add(group);
    }
    for (let d = 80; d < this.length; d += 130) {
      const { point, tangent } = this.frame(d, -6);
      const group = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, 2.8, 6), dark); pole.position.y = 1.4;
      const sign = this.sign('› ›', 1.7, .8, '#f1cb65'); sign.position.y = 2.55;
      group.add(pole, sign); group.position.copy(point); group.rotation.y = Math.atan2(-tangent.x, -tangent.z); this.scene.add(group);
    }
  }
  sign(text, width, height, background) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#17372e'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 50);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  }
  createBike() {
    const group = this.bike = new THREE.Group();
    const metal = material('#788889', { metalness: .85, roughness: .3 }), black = material('#141d1d', { roughness: .55 });
    const paint = material('#506555', { metalness: .5, roughness: .3 });
    const bolt = material('#b1b8a7', { metalness: .9, roughness: .24 });
    const tank = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), paint); tank.position.set(0, -.94, -.62); tank.scale.set(.36, .30, .64); group.add(tank);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.095, .095, .025, 16), bolt); cap.position.set(0, -.65, -.55); cap.rotation.x = .25; group.add(cap);
    function cylinderBetween(a, b, radius, mat) {
      const direction = new THREE.Vector3().subVectors(b, a);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 12), mat);
      mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(UP, direction.normalize()); return mesh;
    }
    group.add(cylinderBetween(new THREE.Vector3(-.58, -.50, -1.03), new THREE.Vector3(.58, -.50, -1.03), .035, metal));
    for (const side of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(.052, .052, .25, 12), black); grip.rotation.z = Math.PI / 2; grip.position.set(side * .57, -.49, -.97); group.add(grip);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(.11, .12, .12), black); housing.position.set(side * .43, -.49, -1.03); group.add(housing);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material('#222b29')); glove.position.set(side * .58, -.48, -.94); glove.scale.set(.105, .085, .14); group.add(glove);
      const sleeve = cylinderBetween(new THREE.Vector3(side * .6, -.52, -.87), new THREE.Vector3(side * .75, -.83, -.36), .085, material('#46544c')); group.add(sleeve);
      const mirrorArm = cylinderBetween(new THREE.Vector3(side * .45, -.47, -1.06), new THREE.Vector3(side * .74, -.18, -1.16), .014, black); group.add(mirrorArm);
      const mirror = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), metal); mirror.position.set(side * .76, -.15, -1.17); mirror.scale.set(.16, .08, .026); group.add(mirror);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#90b4bd' })); glass.position.set(side * .76, -.15, -1.139); glass.scale.set(.145, .066, 1); group.add(glass);
      const lever = cylinderBetween(new THREE.Vector3(side * .42, -.43, -1.12), new THREE.Vector3(side * .67, -.43, -1.15), .012, bolt); group.add(lever);
    }
    const screen = new THREE.Mesh(new THREE.BoxGeometry(.31, .19, .04), black); screen.position.set(0, -.45, -1.2); screen.rotation.x = -.16; group.add(screen);
    const canvas = this.bikeScreen = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    this.bikeTexture = new THREE.CanvasTexture(canvas); this.bikeTexture.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(.28, .15), new THREE.MeshBasicMaterial({ map: this.bikeTexture })); face.position.set(0, -.45, -1.175); face.rotation.x = -.16; group.add(face);
    // Transparent code-built wind deflector, sized to keep the road visible.
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, .2, 1.05), new THREE.MeshPhysicalMaterial({ color: '#d6f4e8', transparent: true, opacity: .065, roughness: .1, side: THREE.DoubleSide, depthWrite: false }));
    shield.position.set(0, -.57, -1.45); shield.scale.set(.48, .54, .11); group.add(shield);
    this.camera.add(group);
    this.updateBikeDisplay(0, 'N');
  }
  updateBikeDisplay(speed, gear) {
    const ctx = this.bikeScreen.getContext('2d'); ctx.fillStyle = '#10231c'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#d0edac'; ctx.font = 'bold 64px monospace'; ctx.textAlign = 'center'; ctx.fillText(speed === null ? '—' : Math.round(speed), 112, 84);
    ctx.font = '15px monospace'; ctx.fillText('km/h', 112, 109); ctx.font = '26px monospace'; ctx.fillText(gear ?? '—', 216, 75);
    ctx.fillStyle = '#7eaa7e'; ctx.fillRect(18, 15, 220, 4); this.bikeTexture.needsUpdate = true;
  }
  setQuality(low) {
    this.quality = low ? 'low' : 'high';
    this.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, innerWidth < 700 ? 1.25 : 1.6));
    for (const mesh of this.forest) mesh.count = Math.floor(mesh.instanceMatrix.count * (low ? .55 : 1));
    this.resize();
  }
  update(ride, elapsed, dt, reducedMotion = false) {
    const frame = this.frame(ride.distance + 8, ride.lateral);
    const ahead = this.frame(ride.distance + 8 + 22 + ride.vehicle.speed * .12, ride.lateral * .7);
    const nextTangent = this.frame(ride.distance + 34).tangent;
    const bend = new THREE.Vector3().crossVectors(frame.tangent, nextTangent).y;
    const targetLean = reducedMotion ? 0 : THREE.MathUtils.clamp(-ride.steering * .065 - bend * ride.vehicle.speed * .016, -.16, .16);
    this.lastLean = THREE.MathUtils.damp(this.lastLean, targetLean, 5, dt);
    this.camera.position.copy(frame.point); this.camera.position.y += 1.65;
    if (!reducedMotion && ride.state === 'running') this.camera.position.y += Math.sin(elapsed * 25) * .008 * ride.vehicle.speed / 90;
    const target = ahead.point.clone(); target.y += 1.55;
    this.camera.up.copy(UP); this.camera.lookAt(target); this.camera.rotateZ(this.lastLean);
    const fov = 66 + (reducedMotion ? 0 : Math.min(10, ride.vehicle.speed * .065));
    if (Math.abs(this.camera.fov - fov) > .03) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.bike.rotation.z = -this.lastLean * .25; this.bike.position.y = reducedMotion ? 0 : Math.sin(elapsed * 2) * .002;
    this.water.material.uniforms.time.value = elapsed;
    this.renderer.render(this.scene, this.camera); this.rendered++;
  }
}
