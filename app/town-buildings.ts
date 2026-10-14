import * as T from 'three';
import * as plan from './town-plan';
import { palette, type TownContext } from './town-shared';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */
export function createBuildings(ctx: TownContext, kit: Kit, nature: Nature, props: Props) {
  const { material, lamps, clocks, animated } = ctx;
  const { box, cylinder, cone, sphere, slabRoof, windowAt, door, plinth, lampGlass } = kit;
  const { topiary } = nature;
  const { bench } = props;
  function buildGate(shell: T.Group) {
    // One solid arch mass: piers, spandrels and entablature are a single bevelled extrusion, so no
    // light shows between the piers and the attic. Red and cream voussoirs, battered plinths.
    const W = 2.2,
      D = 1.5,
      r = 0.95,
      foot = 0.45,
      spring = 2.45,
      top = 4.2,
      b = 0.1,
      stone = palette.blonde,
      dress = palette.trim;
    // Plinth corners at (2.35, 0.9) stay inside the causeway sector (21.0 degrees, under 21.8).
    for (const sx of [-1, 1]) box(shell, sx * 1.6, foot / 2, 0, 1.5, foot, D + 0.3, palette.plinth, 'stone', { taper: 0.05 });
    const body = new T.Shape();
    body.moveTo(-W, foot);
    body.lineTo(-r, foot);
    body.lineTo(-r, spring);
    body.absarc(0, spring, r, Math.PI, 0, true);
    body.lineTo(r, foot);
    body.lineTo(W, foot);
    body.lineTo(W, top);
    body.lineTo(-W, top);
    body.closePath();
    const mass = new T.Mesh(
      new T.ExtrudeGeometry(body, { depth: D - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 16 }),
      material(stone, 'stone'),
    );
    mass.position.z = -D / 2 + b;
    mass.castShadow = mass.receiveShadow = true;
    shell.add(mass);
    // Seven chunky voussoirs, alternating dressing and red, standing 0.08 proud of each face.
    for (let i = 0; i < 7; i++) {
      const a0 = (i * Math.PI) / 7 + 0.012,
        a1 = ((i + 1) * Math.PI) / 7 - 0.012,
        ri = r - 0.03,
        ro = 1.5;
      const v = new T.Shape();
      v.moveTo(Math.cos(a0) * ri, spring + Math.sin(a0) * ri);
      v.lineTo(Math.cos(a0) * ro, spring + Math.sin(a0) * ro);
      v.lineTo(Math.cos(a1) * ro, spring + Math.sin(a1) * ro);
      v.lineTo(Math.cos(a1) * ri, spring + Math.sin(a1) * ri);
      v.closePath();
      const m = new T.Mesh(
        new T.ExtrudeGeometry(v, { depth: D + 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 1 }),
        material(i % 2 ? palette.red : dress, 'stone'),
      );
      m.position.z = -(D + 0.16) / 2 + 0.03;
      m.castShadow = m.receiveShadow = true;
      shell.add(m);
    }
    box(shell, 0, 3.8, 0, 0.5, 0.9, D + 0.24, dress, 'stone'); // keystone into cornice
    for (const sx of [-1, 1]) {
      box(shell, sx * (r + 0.1), spring - 0.1, 0, 0.32, 0.2, D + 0.12, dress, 'stone'); // impost
      for (const sz of [-1, 1]) box(shell, sx * 1.6, 1.5, (sz * D) / 2, 0.7, 1.5, 0.12, dress, 'stone'); // pier panel, half set in
    }
    box(shell, 0, top + 0.1, 0, 2 * W + 0.3, 0.2, D + 0.3, dress, 'stone');
    box(shell, 0, top + 0.6, 0, 2 * W - 0.3, 0.8, D - 0.1, stone, 'stone', { segments: 2 });
    for (const sz of [-1, 1]) box(shell, 0, top + 0.6, sz * ((D - 0.1) / 2 + 0.03), 2.4, 0.46, 0.06, palette.bronze, 'brass'); // blank bronze plaques
    box(shell, 0, top + 1.1, 0, 2 * W - 0.1, 0.2, D + 0.1, dress, 'stone');
    box(shell, 0, top + 1.4, 0, 1.6, 0.4, 0.9, stone, 'stone');
    for (const sx of [-1, 1]) {
      cylinder(shell, sx * 1.75, top + 1.45, 0, 0.1, 0.13, 0.5, palette.bronze, 'brass');
      const glow = lampGlass();
      const bowl = new T.Mesh(new T.SphereGeometry(0.24, 14, 10), glow);
      bowl.position.set(sx * 1.75, top + 1.92, 0);
      shell.add(bowl);
      lamps.push(bowl);
    }
    shell.userData.landmark = "LIU'S GATE";
    shell.userData.openingWidth = r * 2;
  }

  function buildHall(shell: T.Group, site: plan.Site) {
    // A squat two-bay block (walls 0.5 to 4.3) under a copper roof, and a fat clock tower that
    // stands 0.6 proud of the front over the arched entrance (tower z 0.4 to 2.9).
    const w = site.w,
      d = site.d,
      tw = 2.5,
      tz = d / 2 + 0.6 - tw / 2;
    plinth(shell, w, d, palette.plinth, { height: 0.5 });
    plinth(shell, tw, tw, palette.plinth, { z: tz, height: 0.52, blocks: true });
    box(shell, 0, 2.4, 0, w, 3.8, d, palette.blonde, 'stone');
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) box(shell, sx * 3.6, 2.4, sz * 2.2, 0.45, 3.8, 0.45, palette.trim, 'stone'); // corner pilasters
      box(shell, sx * 1.475, 2.4, d / 2, 0.45, 3.8, 0.3, palette.trim, 'stone'); // tower-flank pilasters
    }
    box(shell, 0, 2.9, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone'); // string course
    box(shell, 0, 4.4, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone'); // cornice
    // Eave 0.3, not 0.35: a longer front slab's upper corner pokes 0.03 through the tower face
    // (z 2.9) as a thin copper line under the tower window.
    slabRoof(shell, 0, 4.5, 0, w, d + 0.3, 2.2, palette.copper, { eave: 0.3, verge: 0.3, thick: 0.22, ridge: palette.copperLight, gable: palette.blonde });
    // Two bays a side: arched windows below the string course, plain ones above. The rear has masses only.
    for (const sx of [-1, 1]) {
      windowAt(shell, sx * 2.54, 1.5, d / 2, 0.85, 1.15, { arched: true });
      windowAt(shell, sx * 2.54, 3.55, d / 2, 0.85, 0.95, { sill: false, lintel: false });
      const face = new T.Group();
      face.position.x = (sx * w) / 2;
      face.rotation.y = (sx * Math.PI) / 2;
      shell.add(face);
      for (const z of [-0.95, 0.95]) {
        windowAt(face, z, 1.5, 0, 0.85, 1.15, { arched: true });
        windowAt(face, z, 3.55, 0, 0.85, 0.95, { sill: false, lintel: false });
      }
    }
    // The tower: buttresses with pyramid caps either side of the arched door, a mullioned window above.
    box(shell, 0, 4.675, tz, tw, 8.35, tw, palette.blonde, 'stone', { segments: 2 });
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.2, 3.05, tz + 1.2, 0.5, 5.1, 0.5, palette.trim, 'stone');
      cone(shell, sx * 1.2, 5.8, tz + 1.2, 0.4, 0.4, palette.trim, 'stone', 4);
    }
    door(shell, 0, 0.52, tz + tw / 2, 1.3, 2.2, palette.greenDoor, { arched: true, landing: 0.25, width: 2.0 });
    windowAt(shell, 0, 4.65, tz + tw / 2, 0.8, 1.2, { arched: true, mullion: true });
    box(shell, 0, 6.1, tz, tw + 0.3, 0.2, tw + 0.3, palette.trim, 'stone');
    // Four clocks at 70% of the face: an iron rim, a cream dial that glows after dusk like the
    // windows, four iron markers, a fixed brass hub and iron hands that keep Glasgow time.
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const face = new T.Group();
      face.position.set(0, 0, tz);
      face.rotation.y = side;
      shell.add(face);
      // The dial is a flat glass face 0.004 proud of the rim: a dial with sides showed a strip of
      // its upward side above the rim, and that caught the glass glint as a pale ring on the shaded clocks.
      const rim = new T.Mesh(new T.CylinderGeometry(0.95, 0.95, 0.096, 24), material(palette.metal, 'iron'));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, 7.75, tw / 2 + 0.048);
      rim.castShadow = rim.receiveShadow = true;
      face.add(rim);
      const dial = new T.Mesh(new T.CircleGeometry(0.85, 24), material(palette.white, 'glass'));
      dial.position.set(0, 7.75, tw / 2 + 0.1);
      dial.userData.flatGlass = true; // an even cream face under the glass glint, not a window's gradient
      face.add(dial);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        box(face, Math.sin(a) * 0.66, 7.75 + Math.cos(a) * 0.66, tw / 2 + 0.105, 0.1, 0.2, 0.03, palette.metal, 'iron', { rz: -a });
      }
      const hub = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.05, 12), material(palette.brass, 'brass'));
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0, 7.75, tw / 2 + 0.16); // static, so it batches with the tower
      face.add(hub);
      const hands = new T.Group();
      hands.position.set(0, 7.75, tw / 2 + 0.14);
      hands.userData.keepSeparate = true;
      face.add(hands);
      const hour = new T.Group(),
        minute = new T.Group();
      hands.add(hour, minute);
      box(hour, 0, 0.2, 0, 0.09, 0.45, 0.02, palette.ink, 'iron');
      box(minute, 0, 0.3, 0, 0.07, 0.65, 0.02, palette.ink, 'iron');
      clocks.push({ hour, minute });
    }
    // The crown: a cornice, four pinnacles, a copper spire (9.05 to 12.05), a finial and a flag.
    box(shell, 0, 8.95, tz, tw + 0.36, 0.2, tw + 0.36, palette.trim, 'stone');
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        cylinder(shell, sx * 1.25, 9.35, tz + sz * 1.25, 0.16, 0.18, 0.6, palette.trim, 'stone');
        cone(shell, sx * 1.25, 9.9, tz + sz * 1.25, 0.26, 0.5, palette.copper, 'copper', 4);
      }
    cone(shell, 0, 10.55, tz, 1.41, 3.0, palette.copper, 'copper', 4);
    cylinder(shell, 0, 12.55, tz, 0.035, 0.05, 1.2, palette.bronze, 'brass'); // starts 0.1 inside the apex
    sphere(shell, 0, 13.2, tz, 0.1, palette.brass, 'brass');
    const vane = new T.Group();
    vane.position.set(0, 12.85, tz);
    vane.userData.keepSeparate = true;
    shell.add(vane);
    box(vane, 0.42, 0, 0, 0.75, 0.5, 0.04, palette.blueDoor, 'fabric');
    animated.push({
      object: vane,
      update(time) {
        vane.rotation.y = Math.sin(time * 0.3) * 0.8 + Math.sin(time * 0.07) * 1.5;
      },
    });
    // Forecourt planters, grounded, each with a clipped topiary ball.
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.85, 0.25, d / 2 + 1.15, 0.7, 0.5, 0.7, palette.plinth, 'stone', { taper: 0.04 });
      topiary(shell, sx * 1.85, 0.85, d / 2 + 1.15, 0.38, 2);
    }
  }

  function buildStudio(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d,
      white = '#eef0ea';
    // A low kerb-stone plinth under two volumes. A: a glass box in a chunky white frame (corner
    // posts, two bands, sharp mullions) under a green roof slab. B: a rendered block 0.3 behind A's
    // front with metal-framed ribbon windows on its front and on the +x face seen at overview.
    plinth(shell, w, d, palette.kerb, { height: 0.35 });
    const aw = 3.4,
      ah = 4.0,
      ax = -1.1;
    box(shell, ax, 2.35, 0, aw - 0.24, ah, d - 0.24, palette.studioGlass, 'glass').userData.paneSpan = true; // one gentle glint over both storeys
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) box(shell, ax + sx * (aw / 2 - 0.11), 2.35, sz * (d / 2 - 0.11), 0.22, ah, 0.22, white, 'paint');
    // The front bands stop at the door surround (0.83 either side of it) instead of crossing the door.
    const run = aw / 2 - 0.83;
    for (const yb of [0.46, 2.35]) {
      box(shell, ax, yb, -(d / 2 - 0.11), aw, 0.22, 0.22, white, 'paint');
      for (const sx of [-1, 1]) box(shell, ax + sx * (aw / 2 - run / 2), yb, d / 2 - 0.11, run, 0.22, 0.22, white, 'paint');
      box(shell, ax - aw / 2 + 0.11, yb, 0, 0.22, 0.22, d, white, 'paint');
    }
    for (const sz of [-1, 1]) for (const mx of [-aw / 6, aw / 6]) box(shell, ax + mx, 2.35, sz * (d / 2 - 0.11), 0.14, ah, 0.14, white, 'paint', { bevel: 0 });
    box(shell, ax - aw / 2 + 0.11, 2.35, 0, 0.14, ah, 0.14, white, 'paint', { bevel: 0 });
    box(shell, 1.6, 1.85, 0, 2.4, 3.0, d - 0.6, palette.render, 'paint');
    const side = new T.Group();
    side.position.x = 2.8;
    side.rotation.y = Math.PI / 2;
    shell.add(side);
    for (const y of [1.25, 2.5]) {
      windowAt(shell, 1.6, y, (d - 0.6) / 2, 1.9, 0.72, { frame: palette.metal, lintel: false });
      windowAt(side, 0, y, 0, 3.6, 0.72, { frame: palette.metal, lintel: false });
    }
    // The green roof slab: a white coping, a lawn 0.17 proud, three shrub lumps and two tilted panels.
    // The coping is an eave for the glass box. At exactly 0.3 thick its float bounds miss the bake's
    // flat-slab test (<= 0.3), so it says where its underside is.
    const coping = box(shell, ax, 4.5, 0, aw + 0.3, 0.3, d + 0.3, white, 'paint');
    coping.userData.roof = true;
    coping.userData.eaveY = 4.35;
    box(shell, ax, 4.71, 0, aw - 0.2, 0.22, d - 0.2, palette.canopy[1], 'grass');
    for (const [x, y, z] of [[ax - 0.9, 4.95, -1.3], [ax - 1.0, 4.95, 0.6], [ax + 0.8, 4.92, 1.7]]) {
      const lump = new T.Mesh(new T.IcosahedronGeometry(0.32, 1), material(palette.hedge, 'foliage'));
      lump.position.set(x, y, z);
      lump.castShadow = lump.receiveShadow = true;
      shell.add(lump);
    }
    for (let i = 0; i < 2; i++) {
      box(shell, ax + 0.85, 4.89, -1.4 + i * 1.3, 0.9, 0.14, 0.2, palette.metal, 'iron');
      box(shell, ax + 0.85, 4.98, -1.4 + i * 1.3, 1.1, 0.08, 0.8, '#2f4e66', 'enamel', { rx: 0.35 }); // glossy panel, no night glow
    }
    // B's coping (top 3.59) with two planters of clipped topiary.
    box(shell, 1.6, 3.47, 0, 2.6, 0.24, d - 0.4, white, 'paint');
    for (const dz of [-1.2, 1.2]) {
      box(shell, 2.0, 3.77, dz, 0.8, 0.36, 0.5, '#b7ab93', 'stone');
      topiary(shell, 2.0, 4.05, dz, 0.34, 1, 1.15, 0.75, 0.85);
    }
    // The entrance: a white canopy on posts from the ground, a blue door with steps down from the
    // plinth, and a grounded apron with a bench.
    box(shell, ax, 2.7, d / 2 + 0.6, 2.6, 0.22, 1.2, white, 'paint');
    for (const sx of [-1, 1]) cylinder(shell, ax + sx * 1.1, 1.3, d / 2 + 1.05, 0.08, 0.08, 2.6, palette.metal, 'iron');
    door(shell, ax, 0.35, d / 2 - 0.12, 1.3, 2.1, '#3f6f8f', { surround: palette.metal, landing: 0.37, width: 2.0 });
    box(shell, ax, 0.03, d / 2 + 1.2, 3.2, 0.06, 1.8, palette.pavement, 'paving'); // from the plinth foot, like the path
    bench(shell, ax - 0.85, 0.06, d / 2 + 1.85);
  }

  function buildArchive(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d;
    // Red brick walls (0.45-3.65) on a rusticated, battered plinth (the rear is seen at overview) under a pale cornice.
    plinth(shell, w, d, palette.plinth, { height: 0.45, blocks: true });
    box(shell, 0, 2.05, 0, w, 3.2, d, palette.brick, 'stone');
    box(shell, 0, 3.75, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone');
    // Blonde piers: fat corners, and two intermediates on the front and rear framing the hoist bay.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        box(shell, sx * 3.0, 2.05, sz * 2.3, 0.5, 3.2, 0.5, palette.brickLight, 'stone');
        box(shell, sx * 1.05, 2.05, sz * (d / 2 + 0.05), 0.45, 3.2, 0.2, palette.brickLight, 'stone');
      }
    // Arched, metal-framed windows. The rear is seen at overview, so it is a secondary front.
    const arched = { arched: true, frame: palette.metal, dress: palette.brickLight, mullion: true };
    for (const x of [-2.01, 2.01]) windowAt(shell, x, 1.75, d / 2, 0.9, 1.3, arched);
    const rear = new T.Group();
    rear.position.z = -d / 2;
    rear.rotation.y = Math.PI;
    shell.add(rear);
    for (const x of [-2.01, 0, 2.01]) windowAt(rear, x, 1.75, 0, 0.9, 1.3, arched);
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      for (const z of [-0.95, 0.95]) windowAt(face, z, 1.75, 0, 0.9, 1.3, arched);
    }
    // The centre hoist bay: an arched door at dock height, a grounded dock, the hoist beam and block, crates.
    door(shell, 0, 0.45, d / 2, 1.3, 2.0, palette.greenDoor, { arched: true, surround: palette.brickLight, steps: false });
    box(shell, 0, 0.225, d / 2 + 0.6, 2.2, 0.45, 0.9, palette.plinth, 'stone');
    box(shell, 0, 3.45, d / 2 + 0.45, 0.24, 0.24, 1.0, palette.woodDark, 'wood');
    box(shell, 0, 3.18, d / 2 + 0.85, 0.2, 0.3, 0.2, palette.metal, 'iron');
    box(shell, 1.55, 0.3, d / 2 + 0.55, 0.6, 0.6, 0.6, palette.wood, 'wood');
    box(shell, 1.5, 0.84, d / 2 + 0.5, 0.48, 0.48, 0.48, '#b47a48', 'wood', { ry: 0.35 });
    // A real sawtooth: three teeth across x with their ridges along z, each glazed on its tall face.
    const Wr=w+0.3, bw=Wr/3, R=1.35, f=0.15, Dr=d+0.8, rb=0.04, y0=3.85;
    for(let i=0;i<3;i++){ const x0=-Wr/2+i*bw, s=new T.Shape(); s.moveTo(x0,0); s.lineTo(x0+bw,0); s.lineTo(x0+bw,R); s.lineTo(x0,f); s.closePath();
      const t=new T.Mesh(new T.ExtrudeGeometry(s,{depth:Dr-2*rb,bevelEnabled:true,bevelThickness:rb,bevelSize:rb,bevelOffset:-rb,bevelSegments:1}),material(palette.slate,'slate'));
      t.position.set(0,y0,-Dr/2+rb); t.castShadow=t.receiveShadow=true; shell.add(t);
      t.userData.roof = true; t.userData.eaveY = y0; // a tooth's box drops to the cornice top: the eave bake measures from there
      box(shell,x0+bw+0.035,y0+(f+R)/2+0.05,0,0.07,R-f-0.25,Dr-0.6,palette.glass,'glass'); // north light faces local +x (world +z, seen at overview)
      for(const mz of [-1,1]) box(shell,x0+bw+0.08,y0+(f+R)/2+0.05,mz*(Dr-0.6)/6,0.08,R-f-0.25,0.12,palette.metal,'iron');
      box(shell,x0+bw-0.09,y0+R+0.03,0,0.28,0.16,Dr+0.04,palette.slateLight,'slate'); }
    // A fat stack rising through the first tooth (roof at 4.41 there), with a blonde band and a metal cap.
    cylinder(shell, -2.5, 5.9, -1.8, 0.4, 0.48, 4.1, palette.brick, 'stone');
    cylinder(shell, -2.5, 7.4, -1.8, 0.47, 0.47, 0.26, palette.brickLight, 'stone');
    cylinder(shell, -2.5, 8.0, -1.8, 0.5, 0.44, 0.2, palette.metal, 'iron');
  }
  return { buildGate, buildHall, buildStudio, buildArchive };
}
