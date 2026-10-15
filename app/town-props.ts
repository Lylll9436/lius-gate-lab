import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import {
  palette,
  CRANE_BASE,
  HOARDING_THICKNESS,
  hoardingWalls,
  type TownContext,
} from './town-shared';
import type { Kit } from './town-kit';

/* ------------------------------------------------------------------ */
/* Furniture, planting, small things                                   */
/* ------------------------------------------------------------------ */
export function createProps(ctx: TownContext, kit: Kit) {
  const { material, lamps, animated } = ctx;
  const { box, cylinder, cone, sphere, lampGlass } = kit;
  /** A chunky bench: two leg slabs with back posts, one seat slab and one back board. */
  function bench(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    for (const sx of [-0.52, 0.52]) {
      box(b, sx, 0.19, 0.02, 0.1, 0.38, 0.4, palette.metal, 'iron');   // leg slab, 108
      box(b, sx, 0.62, -0.17, 0.1, 0.5, 0.08, palette.metal, 'iron');  // back post, 12
    }
    box(b, 0, 0.42, 0.02, 1.3, 0.1, 0.46, palette.wood, 'wood');      // seat slab, 108
    box(b, 0, 0.7, -0.19, 1.3, 0.26, 0.1, palette.wood, 'wood');      // back board, 108
    return b;
  }
  /**
   * A Sheffield cycle hoop (0.57 wide, 0.49 tall: below a parked bike's bar, which passes over it)
   * along the local x axis; thin, so it casts no shadow.
   */
  function cycleHoop(g: T.Object3D, x: number, y: number, z: number) {
    const h = new T.Group(); h.position.set(x, y, z); g.add(h);
    const steel = '#7d8288'; // galvanised, paler than the street iron, so the hoops part from the tyres
    const parts = [-0.25, 0.25].map((sx) => cylinder(h, sx, 0.1, 0, 0.035, 0.035, 0.2, steel, 'iron'));
    const bow = new T.Mesh(new T.TorusGeometry(0.25, 0.035, 6, 12, Math.PI), material(steel, 'iron'));
    bow.position.y = 0.2;
    h.add(bow);
    for (const m of [...parts, bow]) {
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.noShadow = true;
    }
    return h;
  }
  // Every street and pier lantern shares one glass; the frame loop sets the same glow on all of them.
  const lanternGlass = lampGlass();
  lanternGlass.emissiveIntensity = 0;
  /** A chunky lamp: iron plinth, a round brass collar, thick shaft, a fat lantern (height ± 0.2) and a hat. */
  function lamp(g: T.Object3D, x: number, z: number, height = 1.8, y = plan.terrainHeight(x, z)) {
    const post = new T.Group();
    post.position.set(x, y, z);
    g.add(post);
    const iron = palette.metal;
    box(post, 0, 0.15, 0, 0.34, 0.3, 0.34, iron, 'iron'); // plinth
    cylinder(post, 0, 0.33, 0, 0.14, 0.14, 0.06, palette.brass, 'brass', 12); // brass collar: round, so it sweeps a highlight
    const shaft = new T.Mesh(new T.CylinderGeometry(0.07, 0.085, height - 0.5, 10, 1, true), material(iron, 'iron'));
    shaft.position.y = 0.3 + (height - 0.5) / 2;
    shaft.castShadow = shaft.receiveShadow = true;
    post.add(shaft);
    const lantern = new T.Mesh(new T.BoxGeometry(0.36, 0.4, 0.36), lanternGlass);
    lantern.position.y = height;
    lantern.castShadow = false;
    post.add(lantern);
    cone(post, 0, height + 0.31, 0, 0.32, 0.22, iron, 'iron', 4); // hat
    lamps.push(lantern);
    return post;
  }
  /**
   * The lenses: dark glass tinted red, amber or green (`dark`), and lit by their own emissive
   * (`lit`), a clear bright red, amber or green that reads by day and at night with nothing
   * spilling off the glass. The light alone carries a lit lens's colour: sunlight on a bright base
   * as well would wash it out to salmon and peach under the tone curve. `on` says which aspects
   * light it (red and amber both show in red+amber). These may be the most saturated small accents
   * in the frame after the grade.
   */
  const LENSES: { lit: string; dark: string; on: (a: plan.Aspect) => boolean }[] = [
    { lit: '#ff3426', dark: '#3d1c19', on: (a) => a === 'red' || a === 'redAmber' },
    { lit: '#ffa21f', dark: '#3d2d16', on: (a) => a === 'amber' || a === 'redAmber' },
    { lit: '#1fe39b', dark: '#163a2c', on: (a) => a === 'green' },
  ];
  /** A lit lens's emissive intensity; an unlit one has none. */
  const LENS_GLOW = 0.95;
  /**
   * UK traffic signals at the ring's three junctions (plan.signalPosts), two each: a slim iron pole
   * on a small foot, a black head with three round lenses (red over amber over green) under short
   * visors, and a narrow black backboard, in the street lamps' chunky proportions and about their
   * height. No lettering, no signs. Poles, heads, visors and boards batch with the land; the lenses
   * stay apart (keepSeparate), one small mesh and one material per lens, all made here at build time.
   * The frame loop (the animated entry) re-reads each signal's aspect from town time
   * (plan.signalState) and sets a lens's emissive intensity only when its signal changes, so no
   * aspect ever compiles a shader or adds a program: the lens material is the lanterns' plain
   * standard one. Like the lamps they take no pointer, follow the town's Plan tints and hide with it
   * in Inspect; paused or under reduced motion, town time holds and so do they.
   */
  function trafficSignals(g: T.Object3D) {
    const root = new T.Group();
    root.name = 'traffic-signals';
    root.userData.prebatched = true; // the static parts batch with the land; the lenses stay apart
    g.add(root);
    const black = palette.ink,
      lensGeometry = new T.CylinderGeometry(0.078, 0.078, 0.03, 14).rotateX(Math.PI / 2),
      HEAD_Y = 1.47,
      PITCH = 0.225;
    const heads = plan.signalPosts.map((p) => {
      const post = new T.Group();
      post.position.set(p.x, plan.pavementTop(p.x, p.z) + plan.terrainHeight(p.x, p.z), p.z); // lower where it stands in a dropped crossing
      post.rotation.y = p.heading;
      root.add(post);
      box(post, 0, 0.05, 0, 0.2, 0.1, 0.2, palette.metal, 'iron'); // foot
      const pole = new T.Mesh(new T.CylinderGeometry(0.045, 0.052, 1.1, 10, 1, true), material(palette.metal, 'iron'));
      pole.position.y = 0.1 + 0.55; // into the head's underside
      pole.castShadow = pole.receiveShadow = true;
      post.add(pole);
      box(post, 0, HEAD_Y, 0, 0.27, 0.72, 0.2, black, 'enamel'); // head, 1.11..1.83
      box(post, 0, HEAD_Y, -0.12, 0.43, 0.88, 0.04, black, 'enamel'); // backboard, behind the head
      const lenses = new T.Group();
      lenses.userData.keepSeparate = true;
      post.add(lenses);
      const meshes = LENSES.map((look, k) => {
        const y = HEAD_Y + PITCH * (1 - k);
        // A short visor over each lens: a longer one would hide the lit glass from the high camera.
        box(post, 0, y + 0.095, 0.12, 0.19, 0.02, 0.04, black, 'enamel');
        const lens = new T.Mesh(
          lensGeometry,
          new T.MeshStandardMaterial({ color: look.dark, emissive: look.lit, emissiveIntensity: 0, roughness: 0.3, metalness: 0 }),
        );
        lens.material.name = 'signal-lens';
        lens.position.set(0, y, 0.112);
        lens.castShadow = lens.receiveShadow = false;
        lenses.add(lens);
        return lens;
      });
      return { post: p, meshes, shown: '' as plan.Aspect | '' };
    });
    const update = (time: number) => {
      for (const head of heads) {
        const aspect = plan.signalState(head.post.junction, head.post.approach, time);
        if (aspect === head.shown) continue;
        head.shown = aspect;
        head.meshes.forEach((lens, k) => (lens.material.emissiveIntensity = LENSES[k].on(aspect) ? LENS_GLOW : 0));
      }
    };
    update(0);
    animated.push({ object: root, update });
    return root;
  }
  /** A red enamel phone box: a stone plinth, a fat body with one big pane per face, a blank cream band, a crown and a pyramid hat. */
  function phoneBox(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const p = new T.Group(); p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
    const red = palette.boat; // the palette's accent red
    box(p, 0, 0.1, 0, 0.84, 0.2, 0.84, palette.stoneDark, 'stone'); // plinth
    box(p, 0, 1.0, 0, 0.72, 1.6, 0.72, red, 'enamel'); // body
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = new T.Group(); f.rotation.y = side; p.add(f);
      box(f, 0, 0.98, 0.35, 0.48, 1.04, 0.04, palette.glass, 'glass').userData.window = 'kiosk'; // pane, a cool light all night
      box(f, 0, 0.98, 0.37, 0.07, 1.04, 0.03, red, 'enamel'); // mullion
      box(f, 0, 1.15, 0.37, 0.48, 0.07, 0.03, red, 'enamel'); // transom
      box(f, 0, 1.64, 0.37, 0.5, 0.13, 0.03, palette.white, 'enamel'); // sign band, blank
    }
    box(p, 0, 1.86, 0, 0.84, 0.12, 0.84, red, 'enamel'); // crown
    cone(p, 0, 2.02, 0, 0.58, 0.2, red, 'enamel', 4); // hat
    return p;
  }
  /** A fat green enamel litter bin with a brass band and an iron lid. */
  function bin(g: T.Object3D, x: number, y: number, z: number) {
    cylinder(g, x, y + 0.33, z, 0.24, 0.2, 0.66, palette.greenDoor, 'enamel', 12); // body
    cylinder(g, x, y + 0.5, z, 0.245, 0.245, 0.07, palette.brass, 'brass', 12); // band
    cylinder(g, x, y + 0.7, z, 0.27, 0.27, 0.1, palette.metal, 'iron', 12); // lid
  }
  /** The park bandstand: a fat octagon on a stepped plinth, chunky columns, low panels and a big verdigris hat. */
  function pavilion(g: T.Object3D, x: number, y: number, z: number) {
    const p = new T.Group(); p.position.set(x, y, z); g.add(p);
    /** Flat-faced 8-sided pieces (non-indexed, face normals) so they shade as octagons, not cylinders. */
    const facets = (geo: T.BufferGeometry) => { const flat = geo.toNonIndexed(); geo.dispose(); flat.computeVertexNormals(); return flat; };
    const oct = (rt: number, rb: number, h: number, yc: number, colour: string, kind: SurfaceKind) => {
      const m = new T.Mesh(facets(new T.CylinderGeometry(rt, rb, h, 8)), material(colour, kind));
      m.rotation.y = Math.PI / 8; m.position.y = yc; m.castShadow = m.receiveShadow = true; p.add(m); return m; };
    oct(1.9, 2.0, 0.4, 0.2, palette.stoneDark, 'stone');          // plinth (flat face to +z)
    oct(1.78, 1.78, 0.08, 0.44, palette.plaza, 'paving');         // floor
    box(p, 0, 0.13, 2.02, 1.1, 0.26, 0.34, palette.stoneDark, 'stone'); // steps land on the park's gravel strip
    box(p, 0, 0.065, 2.34, 1.1, 0.13, 0.3, palette.stoneDark, 'stone');
    for (let i = 0; i < 8; i++) {
      const th = Math.PI / 8 + (i * Math.PI) / 4;               // octagon corners (x = r sin, z = r cos)
      const col = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, 2.1, 10, 1, true), material(palette.frame, 'enamel')); // painted cast iron
      col.position.set(1.55 * Math.sin(th), 1.45, 1.55 * Math.cos(th)); col.castShadow = col.receiveShadow = true; p.add(col);
      const mid = th + Math.PI / 8; if (i === 7) continue;     // entrance between corners 7 and 0 faces +z
      box(p, 1.432 * Math.sin(mid), 0.6, 1.432 * Math.cos(mid), 0.95, 0.4, 0.12, palette.frame, 'enamel', { ry: mid });
    }
    oct(1.7, 1.7, 0.32, 2.66, palette.frame, 'enamel');          // closed frieze; columns stop under it
    const roof = new T.Mesh(facets(new T.ConeGeometry(2.3, 1.2, 8)), material(palette.copper, 'copper'));
    roof.rotation.y = Math.PI / 8; roof.position.y = 3.42; roof.castShadow = roof.receiveShadow = true; p.add(roof);
    const fin = new T.Mesh(new T.IcosahedronGeometry(0.16, 1), material(palette.brass, 'brass')); fin.position.y = 4.1; p.add(fin);
    return p;
  }
  /** The park's notice board: two posts, a wooden board with a paper sheet and a slate roof. */
  function memoryBoard(g: T.Object3D, x: number, y: number, z: number, ry: number) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    for (const dx of [-0.6, 0.6]) box(b, dx, 0.8, 0, 0.12, 1.6, 0.12, palette.woodDark, 'wood'); // posts
    box(b, 0, 1.15, 0, 1.35, 0.85, 0.1, palette.wood, 'wood'); // board
    box(b, 0, 1.15, 0.06, 1.15, 0.65, 0.02, palette.white, 'paint'); // paper
    box(b, 0, 1.66, 0, 1.6, 0.12, 0.42, palette.slate, 'slate'); // roof
    return b;
  }
  /** The tower crane on the reserved plot, built from a few thick painted members, with a swinging jib and a hook load. */
  function crane(g: T.Object3D, x: number, z: number) {
    const Y = palette.gold; // crane yellow, enamelled
    const base = new T.Group();
    base.position.set(x, 0, z);
    g.add(base);
    box(base, 0, 0.18, 0, CRANE_BASE, 0.36, CRANE_BASE, '#bdb6a4', 'stone'); // footing
    for (const sx of [-0.3, 0.3])
      for (const sz of [-0.3, 0.3]) box(base, sx, 0.36 + 3.6, sz, 0.16, 7.2, 0.16, Y, 'enamel'); // mast chords
    for (let i = 0; i < 5; i++) {
      const y = 1.26 + i * 1.2;
      for (const s of [-0.3, 0.3]) {
        box(base, 0, y, s, 0.6, 0.09, 0.09, Y, 'enamel'); // ring bars
        box(base, s, y, 0, 0.09, 0.09, 0.6, Y, 'enamel');
      }
      // One diagonal on each camera-facing face.
      box(base, 0, y + 0.6, 0.3, 0.09, 1.34, 0.09, Y, 'enamel', { rz: 0.4636 });
      box(base, 0.3, y + 0.6, 0, 0.09, 1.34, 0.09, Y, 'enamel', { rx: 0.4636 });
    }
    const jib = new T.Group();
    jib.position.set(0, 7.86, 0);
    jib.userData.keepSeparate = true;
    base.add(jib);
    box(jib, 0, 0, 0, 1.1, 0.6, 1.1, Y, 'enamel'); // slewing unit
    box(jib, 0.35, 0.65, 0.1, 0.9, 0.7, 0.8, Y, 'enamel'); // cab
    box(jib, 0.35, 0.7, 0.51, 0.62, 0.38, 0.06, palette.glass, 'glass').userData.window = 'unlit'; // cab window, dark at night
    cone(jib, 0, 1.8, 0, 0.42, 1.6, Y, 'enamel', 4); // apex
    box(jib, 3.3, 0.35, 0, 6.2, 0.22, 0.22, Y, 'enamel'); // top chord
    for (const s of [-0.22, 0.22]) box(jib, 3.3, -0.05, s, 6.2, 0.12, 0.12, Y, 'enamel'); // bottom chords
    for (let i = 0; i < 8; i++) box(jib, 0.75 + i * 0.75, 0.15, 0, 0.09, 0.5, 0.09, Y, 'enamel', { rz: i % 2 ? 0.75 : -0.75 }); // web
    box(jib, -1.5, 0.15, 0, 2.4, 0.18, 0.5, Y, 'enamel'); // counter-jib
    box(jib, -2.3, -0.05, 0, 0.9, 0.8, 0.9, '#9a978c', 'stone'); // counterweight
    box(jib, 1.7, 1.15, 0, 3.9, 0.07, 0.07, palette.metal, 'iron', { rz: -0.34 }); // ties
    box(jib, -1.1, 1.15, 0, 2.5, 0.07, 0.07, palette.metal, 'iron', { rz: 0.55 });
    box(jib, 4.6, -0.2, 0, 0.42, 0.2, 0.5, palette.metal, 'iron'); // trolley
    box(jib, 4.6, -1.7, 0, 0.06, 2.9, 0.06, palette.metal, 'iron'); // line
    box(jib, 4.6, -3.25, 0, 0.36, 0.32, 0.24, palette.boat, 'enamel'); // hook block
    box(jib, 4.6, -3.8, 0, 1.2, 0.18, 0.5, palette.wood, 'wood'); // plank load
    animated.push({
      object: jib,
      update(time) {
        jib.rotation.y = Math.sin(time * 0.07) * 0.9;
      },
    });
    // Hoarding round the plot (lengthened by its thickness so the corners close), with a blue band
    // standing just proud of the top, and building materials inside.
    const plot = plan.reservedPlot;
    for (const [dx, dz, l, ry] of hoardingWalls(plot)) {
      box(g, plot.x + dx, 0.5, plot.z + dz, l + HOARDING_THICKNESS, 1.0, HOARDING_THICKNESS, '#efe2c2', 'paint', { ry });
      box(g, plot.x + dx, 0.93, plot.z + dz, l + 0.14, 0.18, 0.14, palette.blueDoor, 'paint', { ry });
    }
    box(g, plot.x - 1.4, 0.35, plot.z + 1.3, 0.7, 0.7, 0.7, palette.wood, 'wood'); // crates
    box(g, plot.x - 1.4, 1.0, plot.z + 1.3, 0.6, 0.6, 0.6, palette.wood, 'wood', { ry: 0.4 });
    box(g, plot.x + 1.2, 0.225, plot.z + 1.4, 0.9, 0.45, 0.6, palette.brick, 'stone'); // brick pallet
    return base;
  }
  /**
   * A tartan picnic blanket and a hamper on the park turf, front-left of the bandstand under the
   * edge of the west tree: 0.27 clear of the bandstand plinth, 0.5 of the bench (so the bench back
   * hides no more than a corner from the Life chapter's camera) and 0.48 of the trunk.
   * The tartan is one flat colour per triangle on a 0.05 grid, the mix of a muted red, navy, green
   * and cream sett across and along it (0.5 repeat), so no texture can shimmer. It lies 0.012 over
   * the turf (top 0.10), casts no shadow and takes no contact bake.
   */
  function picnic(g: T.Object3D) {
    const spot = { x: -12.25, z: 10.08, ry: 0.12 },
      W = 1.1,
      D = 0.8,
      cell = 0.05;
    const red = new T.Color('#a94a3e'),
      navy = new T.Color('#34506e'),
      green = new T.Color('#3d6450'),
      cream = new T.Color(palette.white);
    // The sett in 0.05 cells: red 4, navy 2, red 1, green 2, cream 1.
    const sett = [red, red, red, red, navy, navy, red, green, green, cream];
    const stripe = (t: number) => sett[((Math.floor(t / cell + 1e-6) % sett.length) + sett.length) % sett.length];
    const geo = new T.PlaneGeometry(W, D, Math.round(W / cell), Math.round(D / cell)).rotateX(-Math.PI / 2).toNonIndexed();
    const p = geo.getAttribute('position'),
      out = new Float32Array(p.count * 3),
      c = new T.Color();
    for (let i = 0; i < p.count; i += 3) {
      const u = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 + W / 2,
        v = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 + D / 2;
      c.copy(stripe(u)).lerp(stripe(v), 0.5);
      for (let k = 0; k < 3; k++) c.toArray(out, (i + k) * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
    const rug = new T.Group();
    rug.position.set(spot.x, 0.112, spot.z);
    rug.rotation.y = spot.ry;
    g.add(rug);
    const blanket = new T.Mesh(geo, material('#ffffff', 'fabric'));
    blanket.castShadow = false;
    blanket.receiveShadow = true;
    blanket.userData.noShadow = true;
    rug.add(blanket);
    // A wicker hamper on the back corner, away from the Life chapter's camera: a pale wicker basket,
    // a slightly darker lid and an arched cane handle over it, so it reads as a basket, not a box.
    const hamper = new T.Group();
    hamper.position.set(-0.32, 0, -0.17);
    hamper.rotation.y = -0.18;
    rug.add(hamper);
    box(hamper, 0, 0.12, 0, 0.42, 0.24, 0.3, '#b08a5c', 'wood');
    box(hamper, 0, 0.265, 0, 0.45, 0.05, 0.33, '#9c7850', 'wood');
    const handle = new T.Mesh(new T.TorusGeometry(0.1, 0.016, 6, 12, Math.PI), material(palette.woodDark, 'wood'));
    handle.position.y = 0.29; // the arch stands on the lid along the basket's length
    handle.castShadow = handle.receiveShadow = true;
    hamper.add(handle);
    return rug;
  }
  /**
   * The Duke of Wellington as Glasgow knows him: a dark bronze rider on a chunky standing horse, an
   * orange traffic cone on his head, on a plain stone plinth (a base course, a battered die and a
   * cornice; no inscription) over a 12-sided paved pad. About 3.6 to the cone's tip.
   */
  function wellington(g: T.Object3D) {
    const [x, z] = plan.statueSpot,
      bronze = '#5f5a4a'; // dark, cool bronze (s 0.22) on the iron finish: half metal, so the sun still models it
    const root = new T.Group();
    root.position.set(x, 0, z);
    root.rotation.y = plan.statueHeading;
    g.add(root);
    const pad = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 0.1, 12), material(palette.plazaDark, 'paving'));
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    root.add(pad);
    box(root, 0, 0.21, 0, 1.5, 0.22, 2.3, palette.plinth, 'stone'); // base course 0.10..0.32
    box(root, 0, 0.795, 0, 1.2, 0.95, 2.0, palette.blonde, 'stone', { taper: 0.05 }); // die 0.32..1.27
    box(root, 0, 1.35, 0, 1.38, 0.16, 2.18, palette.trim, 'stone'); // cornice 1.27..1.43
    const y0 = 1.43;
    // The horse, chunky and nose to the hall steps: a deep barrel on short, stout legs (the near
    // foreleg stepping forward), the neck leaning well forward and the head bowed.
    for (const sx of [-0.16, 0.16])
      for (const sz of [-0.42, 0.42]) {
        const step = sx > 0 && sz > 0 ? 0.18 : 0;
        box(root, sx, y0 + 0.28, sz + step * 0.25, 0.17, 0.56, 0.17, bronze, 'iron', { rx: -step }); // leg
      }
    box(root, 0, y0 + 0.78, 0, 0.56, 0.56, 1.3, bronze, 'iron', { bevel: 0.18 }); // barrel
    const neck = new T.Group();
    neck.position.set(0, y0 + 0.92, 0.48);
    neck.rotation.x = 0.75;
    root.add(neck);
    box(neck, 0, 0.22, 0, 0.32, 0.55, 0.34, bronze, 'iron');
    box(neck, 0, 0.24, -0.17, 0.07, 0.5, 0.07, bronze, 'iron'); // mane
    const head = new T.Group();
    head.position.set(0, y0 + 1.3, 0.82);
    head.rotation.x = 1.0;
    root.add(head);
    box(head, 0, 0.02, 0.12, 0.24, 0.26, 0.5, bronze, 'iron'); // head, nose down
    for (const s of [-1, 1]) box(head, s * 0.07, 0.16, -0.1, 0.05, 0.12, 0.05, bronze, 'iron', { rx: -0.8 }); // ear, upright on the poll
    const tail = new T.Group();
    tail.position.set(0, y0 + 0.95, -0.64);
    tail.rotation.x = -0.3;
    root.add(tail);
    box(tail, 0, -0.22, 0, 0.1, 0.45, 0.12, bronze, 'iron');
    // The rider, smaller than the horse: saddle cloth, legs down the flanks, torso, arms forward to the reins, head.
    box(root, 0, y0 + 1.07, -0.05, 0.64, 0.04, 0.5, bronze, 'iron');
    for (const s of [-1, 1]) {
      box(root, s * 0.31, y0 + 0.88, 0.04, 0.14, 0.4, 0.18, bronze, 'iron'); // leg
      box(root, s * 0.21, y0 + 1.3, 0.06, 0.1, 0.32, 0.12, bronze, 'iron', { rx: -0.6 }); // arm, hands forward to the reins
    }
    box(root, 0, y0 + 1.31, -0.05, 0.34, 0.45, 0.25, bronze, 'iron'); // torso
    sphere(root, 0, y0 + 1.67, -0.03, 0.15, bronze, 'iron');
    // The cone, knocked a little askew: a square foot, the cone and its white band.
    const hat = new T.Group();
    hat.position.set(0, y0 + 1.79, -0.03);
    hat.rotation.z = 0.15;
    root.add(hat);
    box(hat, 0, 0.015, 0, 0.28, 0.03, 0.28, palette.tramOrange, 'enamel');
    cone(hat, 0, 0.21, 0, 0.15, 0.36, palette.tramOrange, 'enamel', 12, 0);
    cylinder(hat, 0, 0.03 + 0.4 * 0.36, 0, 0.105, 0.105, 0.06, palette.white, 'enamel', 12);
    return root;
  }
  return { bench, cycleHoop, lamp, trafficSignals, phoneBox, bin, pavilion, memoryBoard, crane, picnic, wellington };
}
export type Props = ReturnType<typeof createProps>;
