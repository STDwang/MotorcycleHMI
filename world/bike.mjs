import * as THREE from '../vendor/three.module.js';

const LIVERIES = [0xef423b, 0xffbc35, 0x43c2ed, 0x86ce53, 0xa78cfa, 0xf4f3ee, 0xff70aa, 0xebff54];
const rubber = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: .9 });
const metal = new THREE.MeshStandardMaterial({ color: 0x909da8, metalness: .8, roughness: .28 });
const dark = new THREE.MeshStandardMaterial({ color: 0x19252f, roughness: .45 });
const visor = new THREE.MeshStandardMaterial({ color: 0x142e3c, metalness: .6, roughness: .12 });
const box = new THREE.BoxGeometry(1, 1, 1), sphere = new THREE.SphereGeometry(1, 12, 8);
function part(parent, geometry, material, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
}
function limb(parent, a, b, radius, material) {
  const v = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * .85, v.length(), 7), material);
  m.position.copy(new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); parent.add(m); return m;
}
export function createBike(livery = 7, canvas) {
  const root = new THREE.Group(), lean = new THREE.Group(); root.add(lean);
  const paint = new THREE.MeshStandardMaterial({ color: LIVERIES[livery], roughness: .29, metalness: .25 });
  const suit = new THREE.MeshStandardMaterial({ color: LIVERIES[livery], roughness: .75 });
  const wheels = [];
  for (const z of [-.73, .76]) {
    const wheel = new THREE.Group(); wheel.position.set(0, .34, z); lean.add(wheel); wheels.push(wheel);
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(.255, .092, 9, 20), rubber); tyre.rotation.y = Math.PI / 2; wheel.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(.215, .215, .17, 14), metal); rim.rotation.z = Math.PI / 2; wheel.add(rim);
    for (let i = 0; i < 5; i++) { const spoke = part(wheel, box, dark, 0, 0, 0, .19, .025, .39); spoke.rotation.x = i / 5 * Math.PI; }
  }
  // Sculpted fairing, tank and tail use cross-section extrusion; every vertex is generated here.
  const shape = new THREE.Shape(); shape.moveTo(-.28, .48); shape.lineTo(-.34, .8); shape.lineTo(-.26, 1.02); shape.lineTo(0, 1.09); shape.lineTo(.26, 1.02); shape.lineTo(.34, .8); shape.lineTo(.28, .48); shape.closePath();
  const fairing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .88, bevelEnabled: true, bevelThickness: .08, bevelSize: .08, bevelSegments: 2, steps: 1 }), paint);
  fairing.position.z = -.25; lean.add(fairing);
  part(lean, sphere, paint, 0, .96, -.15, .3, .22, .45);
  const seat = part(lean, box, dark, 0, .94, -.65, .38, .10, .59); seat.rotation.x = -.08;
  const tail = part(lean, box, paint, 0, 1, -.92, .3, .14, .35); tail.rotation.x = -.15;
  for (const x of [-.23, .23]) {
    limb(lean, [x, .35, .76], [x, 1.03, .48], .035, metal);
    limb(lean, [x, .4, -.73], [x, .64, -.1], .045, metal);
    const lamp = new THREE.MeshStandardMaterial({ color: 0xcaf0ff, emissive: 0xcaf0ff, emissiveIntensity: 2 });
    part(lean, box, lamp, x * .65, .91, .78, .19, .035, .045);
  }
  const screen = part(lean, sphere, new THREE.MeshStandardMaterial({ color: 0x90c5d8, transparent: true, opacity: .35, roughness: .12, side: THREE.DoubleSide }), 0, 1.18, .52, .28, .24, .15);
  screen.rotation.x = -.4;
  limb(lean, [-.42, 1.02, .28], [.42, 1.02, .28], .025, dark);
  part(lean, box, dark, .28, .54, -.61, .15, .14, .6).rotation.x = -.2;
  const rider = new THREE.Group(); lean.add(rider);
  part(rider, sphere, suit, 0, 1.3, -.25, .24, .37, .23).rotation.x = .65;
  part(rider, sphere, dark, 0, 1.03, -.57, .25, .18, .22);
  part(rider, sphere, paint, 0, 1.57, .08, .195, .22, .22);
  part(rider, sphere, visor, 0, 1.59, .22, .17, .11, .10);
  for (const side of [-1, 1]) {
    limb(rider, [side * .2, 1.44, -.08], [side * .37, 1.13, .08], .08, suit);
    limb(rider, [side * .37, 1.13, .08], [side * .38, 1.02, .27], .065, dark);
    limb(rider, [side * .18, 1.04, -.56], [side * .38, .7, -.16], .105, suit);
    limb(rider, [side * .38, .7, -.16], [side * .22, .48, -.54], .08, dark);
  }
  let texture;
  if (canvas) {
    texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(.49, .184), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    dash.position.set(0, 1.23, .36); dash.rotation.x = .85; dash.rotation.y = Math.PI; lean.add(dash);
  }
  return { root, lean, rider, wheels, texture,
    update(pose, track, dt) {
      const f = track.frame(pose.s, pose.d); root.position.set(f.x, f.y, f.z);
      root.rotation.set(0, Math.atan2(f.tx, f.tz) - pose.psi, 0); lean.rotation.z = pose.lean; lean.rotation.x = pose.pitch - Math.atan(f.slope);
      rider.position.x = -Math.sin(pose.lean) * .17; rider.rotation.z = pose.lean * .14;
      for (const wheel of wheels) wheel.rotation.x += pose.speed * dt / .34;
      if (texture) texture.needsUpdate = true;
    } };
}
