import * as T from 'three';
import * as plan from './town-plan';
import { palette, hash, WATER, type TownContext } from './town-shared';
import type { Kit } from './town-kit';
import type { Props } from './town-props';

/* ------------------------------------------------------------------ */
/* Pier, harbour and lighthouse                                        */
/* ------------------------------------------------------------------ */
export function createHarbour(ctx: TownContext, kit: Kit, props: Props) {
  const { material, lamps, animated } = ctx;
  const { box, cylinder, cone, sphere, hullShape, hullSolid, pitchedRoof, windowAt, lampGlass } = kit;
  const { lamp } = props;
  function pierAndHarbour(g: T.Object3D) {
    const [sx, sz] = plan.pier.start,
      [dx, dz] = plan.pier.dir;
    const heading = Math.atan2(dx, dz);
    const p = new T.Group();
    p.position.set(sx, 0, sz);
    p.rotation.y = heading;
    g.add(p);
    const L = plan.pier.length,
      W = plan.pier.width;
    // A chunky deck: a stone landing on the grass, two stringers, wobbly two-tone planks and fat
    // piles that stand 0.3 proud as bollards. Pier-local +x is (dz, -dx), +z runs out to sea.
    const plank = [palette.wood, '#94613a'], dark = palette.woodDark;
    box(p, 0, 0.1, -0.35, W + 0.3, 0.2, 0.7, palette.stoneDark, 'stone'); // stone landing on the grass
    for (const side of [-1, 1]) box(p, side * 0.62, 0.03, (L + 0.2) / 2, 0.16, 0.14, L + 0.2, dark, 'wood'); // stringers
    const count = Math.round((L + 0.2) / 0.42), pitch = (L + 0.2) / count; // 15 planks
    for (let k = 0; k < count; k++)
      box(p, (hash(k * 5 + 1) - 0.5) * 0.06, 0.15 + (hash(k * 5 + 2) - 0.5) * 0.02, (k + 0.5) * pitch, W + 0.12, 0.1, pitch - 0.045, plank[k % 2], 'wood', { ry: (hash(k * 5 + 3) - 0.5) * 0.05 });
    for (let z = 0.9; z < L + 0.2; z += 1.3) for (const side of [-1, 1]) cylinder(p, side * 0.72, -0.05, z, 0.14, 0.15, 1.1, dark, 'wood', 18); // piles 0.3 proud = bollards
    const lastPile = 0.9 + 1.3 * Math.floor((L + 0.2 - 0.9) / 1.3); // 6.1
    // Lamps stand on the boards (y 0.2), with the pier-local position passed straight through.
    lamp(p, 0.42, 0.45, 1.8, 0.2);
    lamp(p, -0.38, L - 0.45, 1.8, 0.2);
    cylinder(p, 0.72, 1.45, lastPile, 0.035, 0.04, 1.9, palette.metal, 'iron', 18); // flagpole on the seaward pile
    box(p, 0.33, 2.12, lastPile, 0.75, 0.5, 0.04, palette.blueDoor, 'fabric'); // cloth
    for (const s of [-1, 1]) box(p, 0.33, 2.12, lastPile + 0.03, 0.82, 0.09, 0.02, palette.white, 'fabric', { rz: s * 0.588 }); // saltire
    box(p, 1.25, 0.3, 1.5, 0.6, 0.6, 0.6, plank[0], 'wood', { ry: 0.2 }); // crates 0.55-0.7 of a person
    box(p, 1.28, 0.85, 1.48, 0.5, 0.5, 0.5, palette.gold, 'paint', { ry: -0.15 });
    cylinder(p, 2.85, 0.3, 1.6, 0.24, 0.22, 0.6, plank[0], 'wood', 18); // barrel with two hoops
    for (const y of [0.12, 0.48]) cylinder(p, 2.85, y, 1.6, 0.255, 0.255, 0.05, palette.metal, 'iron', 18);
    // A harbour master's hut on a plinth at the landward end: steep pantile roof, chimney,
    // a plain chunky door and a lifebuoy on the side wall.
    const hut = new T.Group();
    hut.position.set(W / 2 + 1.15, 0, 0.1);
    hut.rotation.y = -0.2;
    p.add(hut);
    box(hut, 0, 0.15, 0, 1.7, 0.3, 1.5, palette.stoneDark, 'stone'); // plinth
    box(hut, 0, 0.95, 0, 1.5, 1.3, 1.3, palette.render, 'paint'); // walls 0.30..1.60
    pitchedRoof(hut, 0, 1.6, 0, 2.0, 1.8, 0.95, palette.pantile, { ridgeColor: palette.pantileLight }); // 0.25 overhang, rise 37%
    box(hut, 0.42, 2.2, -0.3, 0.34, 0.8, 0.34, palette.red, 'stone'); // chimney
    box(hut, 0.42, 2.65, -0.3, 0.44, 0.1, 0.44, palette.trimRed, 'stone');
    cylinder(hut, 0.42, 2.78, -0.3, 0.08, 0.09, 0.16, palette.brick, 'stone', 18);
    // The wall is only 1.5 wide: a small window without sill or lintel keeps clear of the door jamb.
    windowAt(hut, -0.43, 1.0, 0.65, 0.38, 0.5, { sill: false, lintel: false });
    box(hut, 0.32, 0.8, 0.67, 0.52, 1.0, 0.1, palette.blueDoor, 'enamel'); // own door leaf on the plinth, no door() panels
    for (const s of [-1, 1]) box(hut, 0.32 + s * 0.36, 0.86, 0.67, 0.14, 1.12, 0.14, palette.trim, 'stone');
    box(hut, 0.32, 1.44, 0.68, 0.86, 0.16, 0.16, palette.trim, 'stone');
    sphere(hut, 0.5, 0.8, 0.73, 0.045, palette.brass, 'brass', 12);
    const ring = new T.Mesh(new T.TorusGeometry(0.17, 0.055, 8, 16), material(palette.flowers[0], 'enamel'));
    ring.position.set(0.78, 0.95, 0.1);
    ring.rotation.y = Math.PI / 2;
    ring.castShadow = true;
    hut.add(ring);
    // Two chunky channel buoys, a red can and a green cone, flanking the pier head: out past both
    // foam lines in the bay's shallows, and at least 0.5 clear of the boat's loop.
    const marks = [[2.0, 5.7, palette.boat, 'can'], [-2.6, 5.9, palette.greenDoor, 'cone']] as const;
    for (const [i, [lx, lz, colour, top]] of marks.entries()) {
      const buoy = new T.Group();
      buoy.position.set(sx + dz * lx + dx * lz, WATER, sz - dx * lx + dz * lz);
      buoy.userData.keepSeparate = true;
      g.add(buoy);
      cylinder(buoy, 0, 0.05, 0, 0.3, 0.34, 0.4, colour, 'enamel', 18); // float -0.15..0.25
      cylinder(buoy, 0, 0.12, 0, 0.325, 0.33, 0.1, palette.white, 'enamel', 18); // white band, about 0.015 proud
      if (top === 'can') box(buoy, 0, 0.45, 0, 0.26, 0.4, 0.26, colour, 'enamel');
      else cone(buoy, 0, 0.47, 0, 0.22, 0.44, colour, 'enamel', 18, 0);
      const glow = lampGlass();
      const lampMesh = new T.Mesh(new T.SphereGeometry(0.08, 12, 8), glow);
      lampMesh.position.y = top === 'can' ? 0.72 : 0.76;
      buoy.add(lampMesh);
      lamps.push(lampMesh);
      animated.push({
        object: buoy,
        update(time) {
          buoy.position.y = WATER + Math.sin(time * 1.3 + i * 2) * 0.03;
          buoy.rotation.z = Math.sin(time * 0.9 + i) * 0.08;
        },
      });
    }
    // A dinghy moored alongside the deck, on the side away from the hut, its stern past the foam:
    // a shaped white hull with a blue rubbing band, a visible wooden floor and a seated thwart.
    const dinghy = new T.Group();
    dinghy.position.set(sx + dx * 5.3 + plan.pier.tangent[0] * 1.4, WATER, sz + dz * 5.3 + plan.pier.tangent[1] * 1.4);
    dinghy.rotation.y = heading + 0.06;
    dinghy.userData.keepSeparate = true;
    g.add(dinghy);
    // The hull's top cap sits 0.005 under the band's, so the two caps don't z-fight on the gunwale.
    hullSolid(dinghy, 0.34, 0.8, 0.72, -0.06, 0.155, 0.04, palette.white, 'enamel'); // -0.06..0.175, waterline 0.06 up
    hullSolid(dinghy, 0.36, 0.81, 0.73, 0.1, 0.02, 0.03, palette.blueDoor, 'enamel'); // rubbing band 0.10..0.18, 0.01 proud
    const floor = new T.Mesh(new T.ShapeGeometry(hullShape(0.27, 0.66, 0.6), 4).rotateX(-Math.PI / 2), material(palette.wood, 'wood'));
    floor.position.y = 0.185;
    floor.receiveShadow = true;
    dinghy.add(floor);
    box(dinghy, 0, 0.23, -0.1, 0.72, 0.07, 0.2, palette.woodDark, 'wood'); // thwart resting on the gunwales
    animated.push({
      object: dinghy,
      update(time) {
        dinghy.position.y = WATER + Math.sin(time * 1.1 + 1) * 0.015;
        dinghy.rotation.x = Math.sin(time * 0.8) * 0.02;
      },
    });
  }
  function lighthouse(g: T.Object3D) {
    const [x, z] = plan.lighthouseRock;
    const rock = new T.Group();
    rock.position.set(x, 0, z);
    g.add(rock);
    // Four dark, rounded boulders that stand clear of the water, with a gentle ramp (0.85 to 1.02,
    // paler on top); batch()'s contact bake supplies the wet, darker foot. The big one under the
    // tower sits lower, so it meets the plinth below its cap (at most 0.6 up) instead of cutting
    // through the cream ring at the tower's foot.
    ([[0, -0.5, 0, 1.6, 1.25, 0.8, 1.1, '#6b7670'], [1.35, -0.3, 0.7, 1.0, 1.2, 0.8, 1.0, '#646f69'], [-1.25, -0.35, -0.45, 1.1, 1.1, 0.8, 1.2, '#717b75'], [0.4, -0.4, -1.4, 0.9, 1.3, 0.8, 1.0, '#646f69']] as const).forEach(([bx, by, bz, r, sx, sy, sz, c], i) => {
      const geo = new T.IcosahedronGeometry(r, 1),
        p = geo.getAttribute('position'),
        col = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) col.fill(0.85 + 0.17 * T.MathUtils.smoothstep(by + p.getY(k) * sy, -0.1, 0.6), k * 3, k * 3 + 3);
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      const s = new T.Mesh(geo, material(c, 'stone'));
      s.position.set(bx, by, bz);
      s.scale.set(sx, sy, sz);
      s.rotation.y = i * 1.3;
      s.castShadow = s.receiveShadow = true;
      rock.add(s);
    });
    // A fat striped drum: the gallery is wider than the shaft and the lantern sits on the deck.
    const white = palette.white, red = palette.boat, cream = palette.tramCream, iron = palette.metal, face = 0.8;
    cylinder(rock, 0, 0.45, 0, 1.05, 1.2, 0.5, palette.plinth, 'stone', 24); // plinth 0.20-0.70
    // The cap is a trim band, not an overhang. As a slab, batch() would bake it as an eave over the whole
    // shaft (whose foot it sleeves) and, through its square box, over the plinth's diagonals only.
    cylinder(rock, 0, 0.74, 0, 1.0, 1.08, 0.08, cream, 'stone', 24).userData.ground = true; // cap
    cylinder(rock, 0, 2.15, 0, 0.68, 0.9, 2.9, white, 'paint', 24); // shaft 0.70-3.60: painted masonry, so matte
    const shaftR = (y: number) => 0.9 - (0.22 * (y - 0.7)) / 2.9;
    for (const [y0, y1] of [[1.6, 2.1], [2.75, 3.25]]) cylinder(rock, 0, (y0 + y1) / 2, 0, shaftR(y1) + 0.03, shaftR(y0) + 0.03, y1 - y0, red, 'enamel', 24); // 0.03 proud
    box(rock, Math.sin(face) * 0.78, 1.02, Math.cos(face) * 0.78, 0.42, 0.62, 0.25, palette.greenDoor, 'enamel', { ry: face }); // door
    box(rock, Math.sin(face) * 0.71, 2.42, Math.cos(face) * 0.71, 0.26, 0.36, 0.2, '#2d3838', 'glass', { ry: face }); // window, lit at night
    cylinder(rock, 0, 3.72, 0, 1.0, 0.7, 0.24, cream, 'stone', 24); // corbel 3.60-3.84
    cylinder(rock, 0, 3.92, 0, 1.02, 1.02, 0.16, iron, 'iron', 24); // gallery deck 3.84-4.00 (wider than shaft)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      box(rock, Math.cos(a) * 0.94, 4.17, Math.sin(a) * 0.94, 0.08, 0.34, 0.08, iron, 'iron');
    }
    const rail = new T.Mesh(new T.TorusGeometry(0.94, 0.05, 8, 32), material(iron, 'iron'));
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 4.34;
    rail.castShadow = true;
    rock.add(rail);
    const glass = lampGlass();
    const lanternRoom = new T.Mesh(new T.CylinderGeometry(0.56, 0.56, 0.8, 24), glass);
    lanternRoom.position.y = 4.4; // 4.00-4.80, sits on the deck
    rock.add(lanternRoom);
    lamps.push(lanternRoom);
    for (let i = 0; i < 4; i++) box(rock, Math.cos((i * Math.PI) / 2) * 0.56, 4.4, Math.sin((i * Math.PI) / 2) * 0.56, 0.1, 0.8, 0.1, iron, 'iron'); // mullions off the camera axis
    cylinder(rock, 0, 4.85, 0, 0.66, 0.66, 0.1, iron, 'iron', 24);
    const dome = new T.Mesh(new T.SphereGeometry(0.64, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), material(red, 'enamel'));
    dome.scale.y = 0.85;
    dome.position.y = 4.9;
    dome.castShadow = dome.receiveShadow = true;
    rock.add(dome);
    sphere(rock, 0, 5.52, 0, 0.12, palette.brass, 'brass', 18);
    // The beam at night: a cone of light that only adds light. It is brightest by the lamp and
    // gone by its open end, and fades towards its edges (only the side facing the camera is
    // drawn, so the cone shows as one soft layer). It swings slowly either side of the seaward
    // bearing and never turns round over the town.
    const beamLength = 18,
      beamRadius = 3.6;
    const beamMaterial = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.fog,
        {
          // Paler than the lantern glass: over the blue sea a warm beige turns pink, a near-white reads as light.
          color: { value: new T.Color('#fff0d4') },
          strength: { value: 0 },
          beamLength: { value: beamLength },
          slope: { value: beamRadius / beamLength },
        },
      ]),
      vertexShader: `
        #include <fog_pars_vertex>
        uniform float beamLength;
        varying vec3 vLocal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying vec3 vViewPosition;
        void main(){
          vLocal=vec3(position.x/beamLength,position.yz);
          vAxisX=normalMatrix*vec3(1.,0.,0.);
          vAxisY=normalMatrix*vec3(0.,1.,0.);
          vAxisZ=normalMatrix*vec3(0.,0.,1.);
          vec4 mvPosition=modelViewMatrix*vec4(position,1.);
          vViewPosition=-mvPosition.xyz;
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform vec3 color;
        uniform float strength;
        uniform float slope;
        varying vec3 vLocal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying vec3 vViewPosition;
        void main(){
          // The true cone normal at this pixel (not the faceted mesh's), so the falloff has no streaks.
          vec2 around=normalize(vLocal.yz+1e-6);
          vec3 n=normalize(-slope*vAxisX+around.x*vAxisY+around.y*vAxisZ);
          vec3 toEye=isOrthographic?vec3(0.,0.,1.):normalize(vViewPosition);
          // Full down the middle of the cone, nothing well before its silhouette: with u the
          // distance from the middle as a share of the width, facing^4 = (1-u^2)^2.
          float across=pow(max(dot(n,toEye),0.),4.);
          // From the lantern glass outwards, falling to nothing at the open end.
          float along=clamp(vLocal.x,0.,1.);
          along=smoothstep(.02,.07,along)*pow(1.-along,2.2);
          float a=strength*across*along;
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              a*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
            #else
              a*=1.-smoothstep(fogNear,fogFar,vFogDepth);
            #endif
          #endif
          gl_FragColor=vec4(color,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: T.FrontSide,
      // Additive light; the target's alpha (the composite divides by it) stays as it was.
      blending: T.CustomBlending,
      blendSrc: T.SrcAlphaFactor,
      blendDst: T.OneFactor,
      blendSrcAlpha: T.ZeroFactor,
      blendDstAlpha: T.OneFactor,
    });
    // The apex sits at the lamp and the cone opens along +x.
    const beamGeometry = new T.ConeGeometry(beamRadius, beamLength, 32, 1, true).rotateZ(Math.PI / 2).translate(beamLength / 2, 0, 0);
    const beam = new T.Mesh(beamGeometry, beamMaterial);
    beam.renderOrder = 4; // over the sea (2) and the shore foam (3), under the rain (5)
    const pivot = new T.Group();
    pivot.position.set(x, 4.4, z);
    pivot.add(beam);
    g.add(pivot);
    pivot.userData.keepSeparate = true;
    // Seaward: straight out from the nearest point of the coast. rotation.y = a turns +x to (cos a, -sin a).
    const shore = plan.islandOutline.reduce((best, p) => (Math.hypot(p[0] - x, p[1] - z) < Math.hypot(best[0] - x, best[1] - z) ? p : best));
    const seaward = Math.atan2(shore[1] - z, x - shore[0]),
      swing = T.MathUtils.degToRad(70);
    animated.push({
      object: pivot,
      update(time, night) {
        pivot.visible = night > 0.01;
        pivot.rotation.y = seaward + swing * Math.sin(time * 0.4);
        beamMaterial.uniforms.strength.value = night * 0.3;
      },
    });
  }
  return { pierAndHarbour, lighthouse };
}
