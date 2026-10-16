import * as T from 'three';
import { GULLY, MANHOLE, PLAZA_PAVING, gullies, manholes, roadPatches, stopLines } from './town-plan';
import { palette } from './town-shared';

export type SurfaceKind =
  | 'stone'
  | 'brick'
  | 'ashlar'
  | 'slate'
  | 'copper'
  | 'pantile'
  | 'wood'
  | 'bark'
  | 'iron'
  | 'brass'
  | 'enamel'
  | 'glass'
  | 'foliage'
  | 'grass'
  | 'paving'
  | 'asphalt'
  | 'soil'
  | 'fabric'
  | 'paint'
  | 'water'
  | 'sand'
  | 'gravel';

/** Ground surfaces: never contact-darkened, never overhangs; their shading comes from the ground itself. */
export const GROUND_KINDS = new Set<SurfaceKind>(['grass', 'paving', 'asphalt', 'sand', 'soil', 'gravel', 'water']);
/** Metal finishes: their boxes get a tighter bevel. */
export const METAL_KINDS = new Set<SurfaceKind>(['iron', 'brass']);
/**
 * Red brick is always coursed brick: a 'stone' part in palette.brick takes the 'brick' kind (so a
 * new brick part needs no tag of its own).
 */
const BRICK_COLOURS = new Set([palette.brick.toLowerCase()]);
/**
 * Each solid kind's surface pattern in the bake shader (0 is plain). batch() writes it per vertex
 * (aBake.w), so the pattern code is the same text for every kind: every solid still shares one
 * program, and kinds that differ only in pattern share one batch (see BATCH_KIND).
 */
const PATTERN: Partial<Record<SurfaceKind, number>> = {
  brick: 1,
  ashlar: 2,
  stone: 3,
  slate: 4,
  pantile: 5,
  copper: 6,
  wood: 7,
  bark: 8,
  foliage: 9,
  paint: 10,
  enamel: 10,
};
/** The pattern batch() bakes for a kind (0 plain). */
export const surfacePattern = (kind: SurfaceKind) => PATTERN[kind] ?? 0;
/** Patterns, by number, for the strength uniform (surfaceGain) and live tuning. */
const PATTERNS = 11;
/**
 * Masonry kinds that differ from 'stone' only in their pattern: they batch with it (same finish,
 * one merged mesh per shell), and the merged mesh says 'stone'.
 */
const BATCH_KIND: Partial<Record<SurfaceKind, SurfaceKind>> = { brick: 'stone', ashlar: 'stone' };
/**
 * Kinds whose pattern reads batch()'s surface coordinates (uv, in units): masonry and roofs
 * (across the face, and up it or up its slope), wood (along the grain, and across it).
 */
export const SURFACE_UV_KINDS = new Set<SurfaceKind>(['brick', 'ashlar', 'slate', 'pantile', 'copper', 'wood']);
/** The coursed kinds' course height (units): batch() starts each mesh's courses at its foot. */
export const COURSE_HEIGHT: Partial<Record<SurfaceKind, number>> = { brick: 0.11, ashlar: 0.34 };

/**
 * One shared uniform object per surface kind, scaling that kind's reflections of the studio
 * room: x where a reflection looks up (the room's lights and ceiling), y where it looks down
 * (its floor).
 */
type SpecUniform = { value: T.Vector2 };
/**
 * A surface kind's finish. `spec` scales its studio reflections (1 when absent); `specFloor`
 * scales the ones that look down at the room's floor instead (`spec` when absent).
 */
type Finish = {
  roughness: number;
  metalness?: number;
  spec?: number;
  specFloor?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
};
/**
 * Only the studio room's reflections (the specular IBL, and the clear coat's) are scaled, after
 * three has gathered them. The diffuse fill, the night dimming and the turn with the view all
 * stay global (scene.environment), so no material carries its own environment map.
 * Every vertical face reflects the room's floor (the camera looks down at 42.6 degrees), so a
 * kind can keep its upward reflections (tops, rounded edges) and leave its walls their colour.
 */
const SPEC_UNIFORM = '#include <common>\nuniform vec2 specBoost;';
const SPEC_PATCH = `#include <lights_fragment_maps>
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
{
   vec3 seen = inverseTransformDirection( reflect( -geometryViewDir, geometryNormal ), viewMatrix );
   radiance *= mix( specBoost.y, specBoost.x, smoothstep( -.35, .15, seen.y ) );
   #ifdef USE_CLEARCOAT
   seen = inverseTransformDirection( reflect( -geometryViewDir, geometryClearcoatNormal ), viewMatrix );
   clearcoatRadiance *= mix( specBoost.y, specBoost.x, smoothstep( -.35, .15, seen.y ) );
   #endif
}
#endif`;
/** The spec patch alone, for the few library materials drawn unbatched (the clock hands). */
function specShader(m: T.MeshStandardMaterial, specU: SpecUniform) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.specBoost = specU;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', SPEC_UNIFORM)
      .replace('#include <lights_fragment_maps>', SPEC_PATCH);
  };
  m.customProgramCacheKey = () => 'lius-spec';
}

/**
 * The glass glint. A pane is flat, and a flat face reflects one direction of the studio (seen
 * from 42.6 degrees above, a window sees only the room's grey floor). So the pane's normal leans
 * up the pane (.3 at its middle, .5 more per unit up, held within 0.6 of the middle) and turns a
 * little across it: the reflection sweeps from the floor (low) up through the walls toward
 * the softboxes (high), one band per pane, darker low and lighter high. The room is read at
 * roughness .4 so the band stays soft instead of mirroring the room's edges.
 * vPane is batch()'s pane coordinates: across the pane and up from its middle, in units.
 * Only the studio room's light sees the lean: its reflection, and its fill a little, which also
 * lifts toward the top of the pane. Direct light keeps the flat pane and its 0.06 roughness,
 * so the sun and the plaza lanterns never strike a hard glint off the glass.
 */
const GLINT_PATCH = `{
   vec3 flatNormal = geometryNormal;
   vec3 upV = ( viewMatrix * vec4( 0., 1., 0., 0. ) ).xyz;
   float tilt = .3 + .5 * clamp( vPane.y, -.6, .6 );
   geometryNormal = normalize( geometryNormal + upV * tilt + vec3( .2 * clamp( vPane.x, -.5, .5 ), 0., 0. ) );
   float sharp = material.roughness;
   material.roughness = max( sharp, .4 );
   ${SPEC_PATCH}
   material.roughness = sharp;
   geometryNormal = flatNormal;
}`;

/** Window light. Warm is 2700K-ish within palette.lantern's saturation (s 0.46); cool is s 0.05. */
const GLASS_GLOW = '#ffd29a',
  WINDOW_WARM = '#ffc68a',
  WINDOW_COOL = '#e4ebef';
/** A colour relative to the glow, as GLSL (the glow itself stays setNight's master). */
const relGlow = (hex: string) => {
  const c = new T.Color(hex),
    g = new T.Color(GLASS_GLOW);
  return `vec3(${[c.r / g.r, c.g / g.g, c.b / g.b].map((v) => v.toFixed(3)).join(',')})`;
};
/**
 * Each pane's light (batch()'s aWindow: level, tint, off byte, wake byte) against the window
 * clock (out, wake): lit at its level until `out` passes its off byte, then dark; an early riser
 * comes on at 0.8 once `wake` passes its wake byte. Each switch is a 0.002-wide smoothstep, so at
 * the follower's pace a lamp goes out over about 3 s. The tint byte splits at 128: warm below,
 * exactly today's glow at 128, cool at 255. The result scales the emissive, never above 1 in
 * luminance, so a pane never outshines today's glow and nothing spills off the glass.
 */
const WINDOW_VERTEX = `{ float on = aWindow.r * (1. - smoothstep(aWindow.b, aWindow.b + .002, windowClock.x));
  on = max(on, .8 * step(aWindow.a, .999) * smoothstep(aWindow.a, aWindow.a + .002, windowClock.y));
  float t = floor(aWindow.g * 255. + .5); // the tint byte: 0 warm, 128 exactly today's glow, 255 exactly cool
  vWindow = on * (t < 128. ? mix(${relGlow(WINDOW_WARM)}, vec3(1.), t / 128.) : mix(vec3(1.), ${relGlow(WINDOW_COOL)}, (t - 128.) / 127.)); }`;
type WindowUniform = { value: T.Vector2 };

/*
 * Surface patterns: restrained procedural texture for the solids, in the bake shader. Every
 * pattern is drawn from the batch's own coordinates (vSurfP, the merged mesh's position; vSurfUV,
 * batch()'s surface coordinates in units), so it holds still on the model as the camera moves.
 * Every one fades to its base tone by its size on screen (sFade): slate and planks, regular lines
 * seen at every zoom and the most prone to moire, are whole while their period spans 5 CSS pixels
 * and gone at 3; brick (only ever seen close) and the soft noise ones (grain, bark, streaks, the
 * leaves) whole from 4 and gone at 2.5; the broad ones that would read at the overview (ashlar,
 * pantile, copper seams, the foliage's clusters) wait for 7-10 and are gone by 4.5-7. So the
 * opening view stays clean and the detail arrives from about zoom 2 (ashlar, roofs) to zoom 4
 * (brick). Sizes on screen are measured
 * along the steepest direction (the length of each coordinate's screen gradient), so a wall seen
 * at a slant fades by its true spacing. The fade counts CSS pixels (device pixels over the pixel
 * ratio, surfacePx), so a Retina screen shows the same detail at a given zoom as any other, only
 * sharper, and nothing is drawn finer than 5 device pixels there: nothing shimmers when the view
 * pans. Joint lines are filtered over the pixel (sLine keeps a line's area, so a sub-pixel joint
 * greys out instead of flickering). Heights for the faint bumps are analytic in the surface
 * coordinates (chained to the screen through their derivatives) or, for the noise patterns, read
 * through the screen derivatives; the normal is tilted once, after three's normal set-up
 * (SURFACE_BUMP). Derivatives are all taken before the pattern's branches.
 */
const SURFACE_PARS = `
uniform float surfaceGain[${PATTERNS}];
uniform float surfacePx;
varying vec4 vBake;
varying vec3 vSurfP;
varying vec3 vSurfN;
varying vec2 vSurfUV;
float sh2(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float sh3(vec3 q){q=fract(q*.1031);q+=dot(q,q.zyx+31.32);return fract((q.x+q.y)*q.z);}
float sn3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(mix(sh3(i),sh3(i+vec3(1.,0.,0.)),f.x),mix(sh3(i+vec3(0.,1.,0.)),sh3(i+vec3(1.,1.,0.)),f.x),f.y),
mix(mix(sh3(i+vec3(0.,0.,1.)),sh3(i+vec3(1.,0.,1.)),f.x),mix(sh3(i+vec3(0.,1.,1.)),sh3(i+1.),f.x),f.y),f.z);}
// 1 while a feature of size s spans hi CSS pixels or more, 0 from lo down; fw is units per device pixel.
float sFade(float s,float fw,float lo,float hi){fw*=surfacePx;return 1.-smoothstep(s/hi,s/lo,fw);}
float sLine(float d,float w,float fw){float e=max(w,fw);return (1.-smoothstep(.5*(e-fw),.5*(e+fw),d))*min(1.,w/max(fw,1e-5));}
struct Blocks{vec2 f;vec2 size;vec2 jd;float k;float row;float col;};
// Coursed blocks on q (across, up): course height H, mean length L, each course's length spread
// by up to +-spread/2 and set over by stagger (0.5 a half bond; below 0 a random bond).
Blocks blocks(vec2 q,float H,float L,float spread,float stagger){Blocks b;b.row=floor(q.y/H);
float len=L*(1.+spread*(sh2(vec2(b.row,1.7))-.5)),off=stagger<0.?sh2(vec2(b.row,5.3)):stagger*mod(b.row,2.);
float u=q.x/len+off;b.col=floor(u);b.size=vec2(len,H);b.f=vec2(fract(u)*len,q.y-b.row*H);
b.jd=min(b.f,b.size-b.f);b.k=sh2(vec2(b.col,b.row)+.37);return b;}
// A block's rounded arris: 0 in the joint (width jw), up to 1 over bev; returns (h, dh/dq).
vec3 arris(Blocks b,float jw,float bev){vec2 t=clamp((b.jd-.5*jw)/bev,0.,1.),e=t*t*(3.-2.*t);
vec2 de=6.*t*(1.-t)/bev*sign(.5*b.size-b.f);return vec3(e.x*e.y,de.x*e.y,e.x*de.y);}`;
/**
 * The patterns (by batch()'s aBake.w; surfaceGain scales each, 1 as built):
 * 1 brick: running bond 0.11 x 0.24, slightly lighter mortar, +-4.5% per brick (and a touch warmer
 *   or cooler), a rounded arris at the joints; a soft mottle at a brick's scale stays once the
 *   courses are gone.
 * 2 ashlar: courses of 0.34 (batch() fits one or two courses to a plinth), blocks about 0.62 long in
 *   a random bond, fine darker joints (relatively darker on a darker stone, so red sandstone reads in
 *   shade as blonde does), +-4% per block, and soft weathering in the bottom metre.
 * 3 stone (dressings, rocks): a very faint broad drift; batch() varies each piece's tone a little.
 * 4 slate: courses of 0.15 across the slope, half-bond slates 0.26 wide, each a shade and a tilt
 *   of its own, lighter at its butt and shaded under the next course's (so the rows read, not a
 *   grid), lying a little steeper than the roof.
 * 5 pantile: S-waves 0.32 across (a roll and a pan), courses of 0.3, troughs shaded.
 * 6 copper: standing seams down the slope every 0.42 and faint verdigris streaks running down.
 * 7 wood: soft grain along the boards; on a planked face, boards 0.15 wide with fine gaps (and a
 *   staggered butt joint about every 2.4).
 * 8 bark: vertical grooves with lighter ridges. 9 foliage: soft leafy clusters in tone and normal.
 * 10 paint, render, enamel: only a faint broad drift. Roof patterns keep to sloped faces.
 * Each pattern keeps its surface's mean tone (brick's lighter mortar is paid for by slightly darker
 * bricks, slate's shaded courses by slightly lighter slates), so nothing brightens or darkens as
 * the detail fades in with the zoom.
 */
const SURFACE_PATTERN = `vec2 surfDH=vec2(0.);float surfH=0.;
{int look=int(vBake.w*255.+.5);
vec2 q=vSurfUV,qdx=dFdx(q),qdy=dFdy(q),fq=vec2(length(vec2(qdx.x,qdy.x)),length(vec2(qdx.y,qdy.y)))+1e-6;
float fp=max(length(dFdx(vSurfP)),length(dFdy(vSurfP)))+1e-6;
if(look>0){float S=surfaceGain[look];vec3 sn=normalize(vSurfN),col=diffuseColor.rgb,hq=vec3(0.);
float roof=smoothstep(.12,.3,sn.y)*(1.-smoothstep(.975,.995,sn.y)),wall=1.-smoothstep(.55,.8,abs(sn.y));
if(look==1){Blocks b=blocks(q,.11,.24,0.,.5);float fy=sFade(.11,fq.y,2.5,4.)*wall,fx=sFade(.24,fq.x,2.5,4.)*fy;
float j=max(sLine(b.jd.y,.014,fq.y)*fy,sLine(b.jd.x,.014,fq.x)*fx),kk=sh2(vec2(b.col,b.row)+7.1)-.5;
col*=(1.+.04*(sn3(vec3(q*2.,2.3))-.5)*sFade(.5,max(fq.x,fq.y),2.5,4.)*wall*S)*(1.+fy*S*(.09*(b.k-.5)-.075))*(1.+fy*S*kk*vec3(.03,-.004,-.03));
col=mix(col,mix(col,vec3(dot(col,vec3(.2126,.7152,.0722))),.55)*1.6,.9*j*S);
hq=.005*fy*S*sFade(.022,max(fq.x,fq.y),1.,2.)*arris(b,.014,.022);}
else if(look==2){Blocks b=blocks(q,.34,.62,.35,-1.);float fy=sFade(.34,fq.y,4.5,7.)*wall,fx=sFade(.45,fq.x,4.5,7.)*fy;
float j=max(sLine(b.jd.y,.012,fq.y)*fy,sLine(b.jd.x,.012,fq.x)*fx);
float jk=mix(.34,.17,smoothstep(.08,.45,dot(col,vec3(.2126,.7152,.0722))));col*=(1.+fy*S*.08*(b.k-.5))*(1.-jk*j*S);
float low=(1.-smoothstep(.1,1.3,vBake.x))*(.55+.45*sn3(vSurfP*vec3(2.2,.8,2.2)));col*=1.-.06*low*wall*S;
hq=.004*fy*S*sFade(.03,max(fq.x,fq.y),1.,2.)*arris(b,.012,.03);}
else if(look==3){col*=1.+.025*(sn3(vSurfP*1.4+3.7)-.5)*S;}
else if(look==4){Blocks b=blocks(q,.15,.26,.25,.5);float fy=sFade(.15,fq.y,3.,5.)*roof,fx=sFade(.26,fq.x,3.,5.)*fy;
float jy=sLine(b.jd.y,.018,fq.y)*fy,jx=sLine(b.jd.x,.01,fq.x)*fx,t=b.f.y/.15;
col*=(1.+fy*S*(.05+.08*(b.k-.5)+.06*(.5-t)-.1*smoothstep(.6,1.,t)))*(1.-(.26*jy+.07*jx)*S);
hq.yz=fy*S*(.07*(vec2(sh2(vec2(b.col,b.row)+2.9),sh2(vec2(b.col,b.row)+5.1))-.5)-vec2(0.,.05));}
else if(look==5){float P=.32,ph=6.2831853*q.x/P;Blocks b=blocks(q,.3,P,0.,0.);
float fy=sFade(.3,fq.y,5.5,8.)*roof,fw=sFade(P,fq.x,5.5,8.)*roof;float jy=sLine(b.jd.y,.022,fq.y)*fy;
col*=(1.+fw*S*(.06+.04*sin(ph+.6)+.02*sin(2.*ph)+.06*(b.k-.5)))*(1.-.22*jy*S);hq.y=.02*fw*S*(cos(ph)+.7*cos(2.*ph))*6.2831853/P;}
else if(look==6){float sd=min(fract(q.x/.42),1.-fract(q.x/.42))*.42,fs=sFade(.42,fq.x,7.,10.)*(1.-smoothstep(.975,.995,sn.y));
float seam=sLine(sd,.024,fq.x)*fs;float st=sn3(vec3(q.x*6.,q.y*.45,1.7))*.7+sn3(vec3(q.x*15.,q.y*1.1,5.3))*.3;
float fst=sFade(.17,fq.x,2.5,4.);col*=mix(vec3(1.),mix(vec3(.95,.955,.96),vec3(1.06,1.08,1.075),st),fst*S)*(1.+.08*seam*S);
float tt=clamp((sd-.012)/.02,0.,1.);hq.y=-.004*fs*S*6.*tt*(1.-tt)/.02*sign(.5-fract(q.x/.42));}
else if(look==7){float planked=step(q.y,500.);vec2 w=vec2(q.x,q.y-1000.*(1.-planked));Blocks b=blocks(w,.15,2.4,.3,-1.);
float fy=sFade(.15,fq.y,3.,5.)*planked,fx=sFade(.6,fq.x,3.,5.)*fy;float jy=sLine(b.jd.y,.012,fq.y)*fy,jx=sLine(b.jd.x,.01,fq.x)*fx;
float g=sn3(vec3(w.x*1.3,w.y*11.,b.row*planked*3.1)),fg=sFade(.09,fq.y,2.5,4.);
col*=(1.+fy*S*.08*(b.k-.5))*(1.-(.3*jy+.25*jx)*S)*(1.+.07*(g-.5)*fg*S);
hq=.004*fy*S*sFade(.016,max(fq.x,fq.y),1.,2.)*arris(b,.012,.016);}
else if(look==8){float g1=sn3(vSurfP*vec3(13.,1.4,13.)),g2=sn3(vSurfP*vec3(31.,3.,31.)+4.1),f1=sFade(.077,fp,2.5,4.),f2=sFade(.032,fp,2.5,4.);
col*=1.+(.16*(g1-.5)*f1+.08*(g2-.5)*f2)*S;surfH=(.012*(g1-.5)*f1+.005*(g2-.5)*f2)*S;}
else if(look==9){float n1=sn3(vSurfP*3.2+vec3(1.3,7.1,2.9)),n2=sn3(vSurfP*8.+vec3(5.2,1.7,9.4)),f1=sFade(.31,fp,4.5,7.),f2=sFade(.125,fp,2.5,4.);
float leaf=(n1-.5)*f1*.6+(n2-.5)*f2*.4;col*=(1.+.14*leaf*S)*(1.-.06*smoothstep(.45,.15,n2)*f2*S)*(1.+.04*(n1-.5)*f1*S*vec3(1.,0.,-1.));
surfH=(.03*(n1-.5)*f1+.012*(n2-.5)*f2)*S;}
else{col*=1.+.02*(sn3(vSurfP*.8)-.5)*S;}
diffuseColor.rgb=col;surfDH=vec2(dot(hq.yz,qdx),dot(hq.yz,qdy));}}`;
/** The patterns' bump: Mikkelsen's surface gradient from the height's screen derivatives (view space, in units). */
const SURFACE_BUMP = `{vec2 dh=surfDH+vec2(dFdx(surfH),dFdy(surfH));vec3 sp=-vViewPosition,sx=dFdx(sp),sy=dFdy(sp);
vec3 r1=cross(sy,normal),r2=cross(normal,sx);float det=dot(sx,r1)*faceDirection;
if(dot(dh,dh)>0.&&abs(det)>0.)normal=normalize(abs(det)*normal-sign(det)*(dh.x*r1+dh.y*r2));}`;
type GainUniform = { value: number[] };
type PxUniform = { value: number };

/**
 * Contact and eave darkening, shaped per fragment from the linear distances batch() bakes into
 * aBake (x height above the ground, y depth below an overhang, both 0..1 over 4 units; z the
 * distance to a concave corner, 0..1 over 1 unit). Linear values interpolate exactly across a
 * face, so the bands stay crisp at any tessellation. Solids then get their surface pattern
 * (aBake.w). The kind's spec uniform scales its reflections; the shader text is the same for every
 * kind, so all standard solids share one program (and the clear-coated ones one more, glass one
 * more).
 */
function bakeShader(m: T.MeshStandardMaterial, specU: SpecUniform, gainU: GainUniform, pxU: PxUniform, glass = false, windowClock?: WindowUniform) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.specBoost = specU;
    if (!glass) {
      shader.uniforms.surfaceGain = gainU;
      shader.uniforms.surfacePx = pxU;
    }
    if (glass && windowClock) shader.uniforms.windowClock = windowClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBake;\nvarying vec4 vBake;' + (glass ? '\nvarying vec2 vPane;\nattribute vec4 aWindow;\nuniform vec2 windowClock;\nvarying vec3 vWindow;' : '\nvarying vec3 vSurfP;\nvarying vec3 vSurfN;\nvarying vec2 vSurfUV;'))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = aBake * vec4(4., 4., 1., 1.);' + (glass ? '\nvPane = uv;\n' + WINDOW_VERTEX : '\nvSurfP = position;\nvSurfN = objectNormal;\nvSurfUV = uv;'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', SPEC_UNIFORM + (glass ? '\nvarying vec4 vBake;\nvarying vec2 vPane;\nvarying vec3 vWindow;' : SURFACE_PARS))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + (glass ? '\ntotalEmissiveRadiance *= vWindow;' : ''))
      .replace('#include <color_fragment>', `#include <color_fragment>
   float contact = mix(.55, 1., smoothstep(0., .7, vBake.x)) * mix(.82, 1., smoothstep(0., .08, vBake.x)); // guide's 0.45 foot band
   diffuseColor.rgb *= contact * mix(.7, 1., smoothstep(0., .45, vBake.y))${glass ? ';' : ` * mix(.8, 1., smoothstep(0., .35, vBake.z));\n${SURFACE_PATTERN}`}`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + (glass ? '' : '\n' + SURFACE_BUMP))
      .replace('#include <lights_fragment_maps>', glass ? GLINT_PATCH : SPEC_PATCH);
  };
  m.customProgramCacheKey = () => (glass ? 'lius-bake-glass' : 'lius-bake-solid');
}

/**
 * The beach's wet band: a swash mark at about 2.2 out from the outline, wandering +-0.13 on a
 * smooth 1.25-unit value noise and anti-aliased by the width's own derivative, then darker sand
 * down to the waterline (2.87), fading out under the foam. The step at the mark (x0.88) carries
 * the read; below it the sand only darkens to x0.85, so the band stays calm. vShoreW is the
 * shore mesh's uv.x.
 */
const SHORE_PARS = `
varying float vShoreW;
float shoreHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`;
const SHORE_WET = `vec2 wq=vGroundP.xz*.8,wi=floor(wq),wf=fract(wq);wf=wf*wf*(3.-2.*wf);
float wob=mix(mix(shoreHash(wi),shoreHash(wi+vec2(1.,0.)),wf.x),mix(shoreHash(wi+vec2(0.,1.)),shoreHash(wi+1.),wf.x),wf.y);
float edge=2.2+.26*(wob-.5),fw=fwidth(vShoreW)+.02;
shoreWet=smoothstep(edge-fw,edge+fw,vShoreW)*(1.-smoothstep(2.88,3.,vShoreW));
diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.88,.87,.86),vec3(.85,.84,.83),smoothstep(edge,2.85,vShoreW)),shoreWet);`;

/*
 * Street details, drawn into the ground shaders so nothing flush with the road or the paving can
 * z-fight, and every fine pattern fades out (by its screen size, from fwidth) before it could
 * shimmer at the overview. `fw` is world units per pixel along the more foreshortened axis.
 */
const f3 = (v: number) => v.toFixed(3);
const vec4s = (name: string, rows: number[][]) => `const vec4 ${name}[${rows.length}] = vec4[${rows.length}](${rows.map((r) => `vec4(${r.map(f3).join(',')})`).join(',')});`;
/**
 * The road: the plan's covers and gullies (centre and road direction), repair patches (world
 * boxes) and stop lines (centre and the traffic's way, and half their length), as constants: no
 * uniforms, so the many lights' uniform budget is untouched.
 */
const ROAD_PARS = () => `
${vec4s('ROAD_COVER', manholes.map((c) => [c.x, c.z, Math.sin(c.heading), Math.cos(c.heading)]))}
${vec4s('ROAD_GULLY', gullies.map((g) => [g.x, g.z, Math.sin(g.heading), Math.cos(g.heading)]))}
${vec4s('ROAD_PATCH', roadPatches.map((p) => p.box))}
${vec4s('ROAD_STOP', stopLines.map((l) => [l.x, l.z, l.along[0], l.along[1]]))}
const float ROAD_STOP_HALF[${stopLines.length}] = float[${stopLines.length}](${stopLines.map((l) => f3(l.length / 2)).join(',')});
float roadHash(float n){return fract(sin(n*127.1+78.23)*43758.5453);}`;
/**
 * Road wear and iron, by the road's own coordinates (vGroundUV: across, along; an avenue's along
 * starts at 1000 x its place in plan.ROADS) and world position. All of it is faint: the wear and the
 * patterns are full from about zoom 2 (`near`) and nearly gone at the overview, where only a soft
 * trace of the covers, gullies, patches and waiting stains stays (`far`).
 * - Wheel tracks: a slightly darker band down the cyclist's lane, grime either side of the rails and
 *   a darker gutter along both kerbs, coming and going along the road.
 * - Repair patches: fresher, darker, cooler asphalt with a thin sealed seam.
 * - Waiting stains: a soft darkening from just behind each stop line to about 2.4 back.
 * - Covers: a dark iron lid with a raised rim (its slopes tilt the normal) and a grid of square
 *   lugs; gullies: an iron frame round slots across the road. Both turn the road iron-like
 *   (groundIron: smoother, a little metallic).
 */
const ROAD_DETAIL = `float near=1.-smoothstep(.016,.04,fw),far=.35+.65*near;
float ax=vGroundUV.x,ring=step(vGroundUV.y,999.),fs=vGroundUV.y*.2,fi=floor(fs),ff=fract(fs);ff=ff*ff*(3.-2.*ff);
float vary=mix(roadHash(fi),roadHash(fi+1.),ff);
float track=ring*(1.-smoothstep(.025,.085,abs(ax+.6)))+ring*.8*(1.-smoothstep(.035,.09,abs(abs(ax)-.42)))+.5*smoothstep(.74,.83,abs(ax));
diffuseColor.rgb*=1.-.12*track*(.4+.6*vary)*near;
for(int i=0;i<ROAD_PATCH.length();i++){vec4 b=ROAD_PATCH[i];vec2 o=max(b.xy-vGroundP.xz,vGroundP.xz-b.zw);float d=max(o.x,o.y);
float inside=1.-smoothstep(-fw,fw,d),seam=1.-smoothstep(.006,.02+fw,abs(d+.012));
diffuseColor.rgb*=mix(vec3(1.),vec3(.925,.93,.945),inside*far)*(1.-.1*seam*near);}
for(int i=0;i<ROAD_STOP.length();i++){vec4 l=ROAD_STOP[i];vec2 q=vGroundP.xz-l.xy;float back=-dot(q,l.zw),side=abs(dot(q,vec2(l.w,-l.z)));
float wait=smoothstep(.07,.3,back)*(1.-smoothstep(.6,2.4,back))*(1.-smoothstep(ROAD_STOP_HALF[i]-.2,ROAD_STOP_HALF[i],side));
diffuseColor.rgb*=1.-.1*wait*far;}
float lugNear=1.-smoothstep(.011,.02,fw);
for(int i=0;i<ROAD_COVER.length();i++){vec2 d=vGroundP.xz-ROAD_COVER[i].xy;float r=length(d);if(r>${f3(MANHOLE.radius + 0.04)})continue;
float lid=1.-smoothstep(${f3(MANHOLE.radius)}-fw,${f3(MANHOLE.radius)}+fw,r),rimUp=smoothstep(.102,.118,r),rimDown=smoothstep(.128,.142,r),rim=rimUp*(1.-rimDown);
vec2 l=abs(fract(vec2(dot(d,ROAD_COVER[i].zw),dot(d,vec2(-ROAD_COVER[i].w,ROAD_COVER[i].z)))/.05)-.5);float aa=fw/.05;
float lug=(1.-smoothstep(.26-aa,.26+aa,l.x))*(1.-smoothstep(.26-aa,.26+aa,l.y))*(1.-rimUp);
float tone=mix(mix(.6,.8,lug),.68,1.-lugNear);tone=mix(tone,.9,rim);
diffuseColor.rgb*=mix(1.,tone,lid*(.5+.5*near));groundIron=max(groundIron,lid);
groundBump+=d/max(r,1e-4)*(.5*4.*rimDown*(1.-rimDown)-.5*4.*rimUp*(1.-rimUp))*lugNear;}
for(int i=0;i<ROAD_GULLY.length();i++){vec2 d=vGroundP.xz-ROAD_GULLY[i].xy;if(dot(d,d)>.04)continue;
vec2 l=vec2(dot(d,ROAD_GULLY[i].zw),dot(d,vec2(-ROAD_GULLY[i].w,ROAD_GULLY[i].z)));vec2 e=abs(l)-vec2(${f3(GULLY.length / 2)},${f3(GULLY.width / 2)});float edge=max(e.x,e.y);
float grate=1.-smoothstep(-fw,fw,edge),frame=smoothstep(-.02-fw,-.02+fw,edge),aa=fw/.044;
float slot=(1.-smoothstep(.3-aa,.3+aa,abs(fract(l.x/.044+.5)-.5)))*(1.-frame);
float tone=mix(.8,mix(mix(.72,.3,slot),.5,1.-lugNear),1.-frame);
diffuseColor.rgb*=mix(1.,tone,grate*(.5+.5*near));groundIron=max(groundIron,grate);}`;
/**
 * The paving: the buff blister slabs of the dropped crossings (their uv is 1000 + world x, z from
 * the slabs' corner), the plaza's granite in rings round the gate (a touch cooler than the
 * sandstone pavements, each flag's tone a little its own) with its band of darker setts
 * (plan.PLAZA_PAVING), and everywhere else the offset flags. The blisters are domes on a 0.06 grid
 * (tilting the normal), the slabs 0.24 square. Derivatives are taken before the branches.
 */
const PAVING = () => {
  const { rim, setts, coping, ring, flag, sett, settRows } = PLAZA_PAVING,
    rowWidth = (rim - setts) / settRows,
    inner = Math.round(coping / ring);
  return `vec2 tq=vGroundP.xz/.9;tq.x+=.5*step(1.,mod(floor(tq.y),2.));vec2 fj=fwidth(tq);float pr=length(vGroundP.xz);
if(vGroundUV.x>500.){vec2 t=vec2(vGroundUV.x-1000.,vGroundUV.y);vec2 c=fract(t/.06)-.5;float rr=length(c)*.06;
float studNear=1.-smoothstep(.011,.02,fw),stud=1.-smoothstep(.017-fw*.7,.017+fw*.7,rr);
vec2 jf=abs(fract(t/.24+.5)-.5)*.24;float sj=1.-smoothstep(0.,.012+fw,min(jf.x,jf.y));
diffuseColor.rgb*=(1.+.03*stud*studNear)*(1.-.16*sj*(1.-smoothstep(.02,.04,fw)));
groundBump+=c*.06/.017*.7*stud*studNear;}
else if(pr<${f3(rim)}){float ang=atan(vGroundP.z,vGroundP.x)/6.2831853,ri,r0,r1,len;
if(pr<${f3(inner * ring)}){ri=floor(pr/${f3(ring)});r0=ri*${f3(ring)};r1=r0+${f3(ring)};len=${f3(flag)};}
else if(pr<${f3(setts)}){ri=${inner.toFixed(1)};r0=${f3(inner * ring)};r1=${f3(setts)};len=${f3(flag)};}
else{ri=${(inner + 1).toFixed(1)}+floor((pr-${f3(setts)})/${f3(rowWidth)});r0=${f3(setts)}+(ri-${(inner + 1).toFixed(1)})*${f3(rowWidth)};r1=r0+${f3(rowWidth)};len=${f3(sett)};}
float isSett=step(${(inner + 0.5).toFixed(1)},ri),n=floor(6.2831853*(r0+r1)*.5/len+.5),a=ang*n+.5*mod(ri,2.),k=mod(floor(a),n);
float ta=ri<.5?1.:min(fract(a),1.-fract(a))*6.2831853*pr/n,jd=min(ta,min(pr-r0,r1-pr));
float th=fract(sin(dot(vec2(ri,k),vec2(127.1,311.7)))*43758.5453),toneNear=1.-smoothstep(.02,.045,fw);
float jn=1.-smoothstep(0.,mix(.05,.022,isSett)+fw,jd),jnear=mix(1.-smoothstep(.027,.054,fw),1.-smoothstep(.009,.018,fw),isSett);
diffuseColor.rgb*=mix(mix(.955+.09*th,.93+.12*th,isSett),mix(1.,.99,isSett),1.-toneNear)*(1.-mix(.18,.22,isSett)*jn*jnear)*mix(vec3(.975,.982,.995),vec3(1.),isSett);}
else{float th=fract(sin(dot(floor(tq),vec2(127.1,311.7)))*43758.5453);vec2 f=fract(tq);float jn=1.-smoothstep(0.,.06+fj.x,min(min(f.x,1.-f.x),min(f.y,1.-f.y)));float jnear=1.-smoothstep(.03,.06,max(fj.x,fj.y));
diffuseColor.rgb*=(.96+.08*th)*(1.-.18*jn*jnear);}`;
};

/** The ground masks' A channel stores terrain height over this range (units). */
export const GROUND_HEIGHT_RANGE = 2;
/** Ground surfaces that read the baked ground masks (water reads them in city-water). */
const MASKED_GROUND = new Set<SurfaceKind>(['grass', 'soil', 'paving', 'asphalt', 'sand', 'gravel']);
type BakeUniforms = { groundMasks: { value: T.Texture }; maskExtent: { value: number } };
/**
 * Ground shade from the baked mask grid, sampled by world XZ: R darkens footprint pads,
 * canopy discs, lamp feet and the grass lip by the pavements (tinted, never grey), B is the
 * mown town lawn that carries a soft 1.5-unit checker, A the terrain height (so only
 * surfaces lying on the ground are shaded, not roof lawns or raised floors).
 * Paving gets offset flags whose joints fade out once a flag is too small on screen; the plaza
 * its granite rings and setts and the dropped crossings their blister slabs (PAVING). Asphalt
 * gets the road's wear, covers and gullies (ROAD_DETAIL); both may tilt the normal (groundBump).
 * Sand gets the wet band: its uv.x is the exact width out from the outline (the shore mesh
 * sets it), and from a swash mark wandering about 2.2 out down to the waterline the sand is
 * darker, darkest at the foam. Any other sand surface needs uv.x = 0 to stay dry.
 */
function groundShader(m: T.MeshStandardMaterial, kind: SurfaceKind, uniforms: BakeUniforms) {
  const tint = kind === 'grass' || kind === 'soil' ? 'vec3(.52, .60, .40)' : 'vec3(.62, .58, .50)';
  const lawn = `vec2 q=vGroundP.xz/1.5;vec2 tri=abs(fract(q*.5)*2.-1.);vec2 fw=fwidth(q)+1e-4;vec2 e=smoothstep(.5-fw,.5+fw,tri);float ch=e.x+e.y-2.*e.x*e.y;
diffuseColor.rgb*=mix(vec3(.93,.95,.90),mix(vec3(.965),vec3(1.035),ch),gs.b);`;
  const sand = kind === 'sand',
    street = kind === 'paving' || kind === 'asphalt';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.groundMasks = uniforms.groundMasks;
    shader.uniforms.maskExtent = uniforms.maskExtent;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundP;' + (sand ? '\nvarying float vShoreW;' : '') + (street ? '\nvarying vec2 vGroundUV;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundP = (modelMatrix * vec4(transformed, 1.)).xyz;' + (sand ? '\nvShoreW = uv.x;' : '') + (street ? '\nvGroundUV = uv;' : ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundP;\nuniform sampler2D groundMasks;\nuniform float maskExtent;' + (sand ? SHORE_PARS : '') + (street ? '\nvarying vec2 vGroundUV;' : '') + (kind === 'asphalt' ? ROAD_PARS() : ''))
      .replace('#include <color_fragment>', `#include <color_fragment>
${sand ? 'float shoreWet=0.;\n' : ''}${street ? 'float groundIron=0.;vec2 groundBump=vec2(0.);\n' : ''}{
${sand ? SHORE_WET + '\n' : ''}vec4 gs=texture2D(groundMasks,vGroundP.xz/(2.*maskExtent)+.5);
float nearGround=1.-smoothstep(.2,.5,vGroundP.y-gs.a*${GROUND_HEIGHT_RANGE.toFixed(1)});
${street ? 'float fw=max(fwidth(vGroundP.x),fwidth(vGroundP.z))+1e-5;\n' : ''}${kind === 'grass' ? lawn : kind === 'paving' ? PAVING() : kind === 'asphalt' ? ROAD_DETAIL : ''}
diffuseColor.rgb*=mix(vec3(1.),${tint},gs.r*nearGround);
}`);
    // The covers' and gullies' iron, and the bumps of rims and blisters (world x, z tilts of the normal).
    if (street)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.55,groundIron);metalnessFactor=mix(metalnessFactor,.35,groundIron);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize(normal+(viewMatrix*vec4(groundBump.x,0.,groundBump.y,0.)).xyz);');
  };
  m.customProgramCacheKey = () => 'lius-ground-' + kind;
}

const fract = (n: number) => n - Math.floor(n);
const hash = (x: number, y: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

function noise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  return T.MathUtils.lerp(
    T.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
    T.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u),
    v,
  );
}
/** Local procedural material maps, with directional grain and filtered distant detail. */
function surfaceMaps(kind: SurfaceKind) {
  const size = 128,
    pigment = new Uint8Array(size * size * 4),
    relief = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        grain = hash(x, y);
      let level = 0.93 + (grain - 0.5) * 0.055,
        height = grain;
      if (kind === 'wood' || kind === 'bark') {
        const wandering =
          Math.sin(u * Math.PI * 2) * 0.1 + Math.sin(u * Math.PI * 6) * 0.018;
        const streak = Math.sin((v * 27 + wandering) * Math.PI * 2);
        const fine = Math.sin((v * 83 + wandering * 3) * Math.PI * 2);
        const knot = Math.exp(-((u - 0.43) ** 2 * 380 + (v - 0.36) ** 2 * 110));
        level =
          0.92 +
          streak * 0.035 +
          fine * 0.015 -
          knot * 0.11 +
          (grain - 0.5) * 0.02;
        height = 0.5 + streak * (kind === 'bark' ? 0.38 : 0.14) + fine * 0.09;
      } else if (kind === 'water') {
        const wave = Math.sin((v * 5 + Math.sin(u * 6.283) * 0.09) * 6.283);
        level = 0.98 + wave * 0.012;
        height = 0.5 + wave * 0.18 + Math.sin((u * 7 + v * 9) * 6.283) * 0.035;
      } else if (kind === 'grass' || kind === 'soil') {
        // Three octaves: meadow drifts, mown patches and blade-level grain.
        // Broad drifts only: blade-level grain reads as pixels in a soft render.
        const patch =
          noise(u * 2.3 + 3.1, v * 2.3 + 7.7) * 0.5 +
          noise(u * 5.7 + 8.2, v * 5.7 - 2.4) * 0.34 +
          noise(u * 13.3 - 5, v * 13.3 + 9) * 0.16;
        // Grass drifts stay within about 5% (linear 0.90-1.0); the ground shader does the rest.
        level = kind === 'grass' ? 0.955 + patch * 0.045 : 0.86 + patch * 0.14;
        height = 0.45 + (grain - 0.5) * 0.32;
      } else if (kind === 'sand' || kind === 'gravel') {
        const ripple = Math.sin((v * 9 + Math.sin(u * 6.283) * 0.18) * 6.283);
        level =
          0.95 +
          (grain - 0.5) * (kind === 'sand' ? 0.045 : 0.12) +
          ripple * 0.008;
        height = 0.5 + (grain - 0.5) * 0.2 + ripple * 0.08;
      } else if (kind === 'paving') {
        const row = Math.floor(v * 4),
          jointX = fract(u * 3 + (row % 2) * 0.5),
          jointY = fract(v * 4);
        const seam = jointX < 0.012 || jointY < 0.017;
        level = seam
          ? 0.72
          : 0.93 +
            (hash(Math.floor(u * 3 + (row % 2) * 0.5), row) - 0.5) * 0.075 +
            (grain - 0.5) * 0.025;
        height = seam ? 0.18 : 0.57 + grain * 0.06;
      } else if (kind === 'slate') {
        const cleft = Math.sin((v * 31 + Math.sin(u * 12.566) * 0.18) * 6.283);
        level = 0.94 + cleft * 0.018 + (grain - 0.5) * 0.025;
        height = 0.5 + cleft * 0.12 + grain * 0.12;
      } else if (kind === 'fabric') {
        level = 0.95 + ((x + y) % 2 ? 0.012 : -0.012);
        height = (x + y) % 2 ? 0.65 : 0.4;
      }
      for (let c = 0; c < 3; c++) {
        pigment[(y * size + x) * 4 + c] = Math.round(Math.min(1, level) * 255);
        relief[(y * size + x) * 4 + c] = Math.round(
          T.MathUtils.clamp(height, 0, 1) * 255,
        );
      }
      pigment[(y * size + x) * 4 + 3] = relief[(y * size + x) * 4 + 3] = 255;
    }
  const map = new T.DataTexture(pigment, size, size),
    bump = new T.DataTexture(relief, size, size);
  for (const texture of [map, bump]) {
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    texture.name = `local-${kind}-grain`;
  }
  map.colorSpace = T.SRGBColorSpace;
  const repeat =
    kind === 'grass' || kind === 'soil'
      ? 0.085
      : kind === 'paving'
        ? 1.1
        : kind === 'wood'
          ? 1.5
          : 2;
  map.repeat.setScalar(repeat);
  bump.repeat.copy(map.repeat);
  return { map, bump };
}

export function createCityMaterials() {
  let night = 0;
  /** The window clock every glass batch material reads (one shared object): x `out`, y `wake`. */
  const windowClock: WindowUniform = { value: new T.Vector2() };
  /** Device pixels per CSS pixel (at least 1), shared by every solid's surface pattern. */
  const surfacePx: PxUniform = { value: 1 };
  const cache = new Map<string, T.MeshStandardMaterial>();
  const maps = new Map<SurfaceKind, ReturnType<typeof surfaceMaps>>();
  // The ground masks are baked by buildTown; until then a black texel leaves the ground untouched.
  const blank = new T.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;
  const bakeUniforms: BakeUniforms = { groundMasks: { value: blank }, maskExtent: { value: 44 } };
  /**
   * A studio render, not a texture atlas: chalky matte clay for masonry, render and ground,
   * soft plastic foliage, satin roofs, and a few real finishes on small props only: dark
   * iron with a soft rim, muted brass, clear-coated enamel and glass. The room environment
   * does the shading; `spec` scales only its reflections (studio 0.25 by day, so a spec of 4
   * sees the room at full strength). Only meadows keep a broad colour drift.
   */
  const finish: Record<SurfaceKind, Finish> = {
    stone: { roughness: 0.9 },
    brick: { roughness: 0.9 },
    ashlar: { roughness: 0.9 },
    slate: { roughness: 0.7, spec: 1.5 },
    copper: { roughness: 0.6, spec: 1.5 }, // verdigris patina: not metallic
    pantile: { roughness: 0.55, spec: 2 }, // glazed terracotta
    wood: { roughness: 0.8 },
    bark: { roughness: 0.95 },
    // A rim on walls and round sections; flat tops stay dark rather than lifting to grey.
    iron: { roughness: 0.4, metalness: 0.5, spec: 2, specFloor: 3 },
    // One pale core on spheres falling off into muted brass; rougher than polished, so the
    // studio's lights merge into one highlight instead of a cluster of hot spots.
    brass: { roughness: 0.4, metalness: 1, spec: 3 },
    // Clear-coat lines on rounded edges and a soft sheen on tops; walls and top faces keep their
    // body colour. No upward boost: at 1.2 the phone box's camera-facing hat facet paled toward
    // salmon (and stronger still turns a dome into a bauble).
    enamel: { roughness: 0.45, spec: 0.8, specFloor: 0.8, clearcoat: 1, clearcoatRoughness: 0.35 },
    // The glint's band (high) at twice the room, its floor (low) at three quarters: windows read
    // as glass by day, never as pale cards at overview, and shaded panes keep a calm lower half
    // instead of dropping to deep navy. Night keeps the warm glow only.
    glass: { roughness: 0.06, spec: 8, specFloor: 3 },
    foliage: { roughness: 0.8 }, // soft plastic; never a sheen (a pale rim round every tree)
    grass: { roughness: 0.95 },
    paving: { roughness: 0.92 },
    asphalt: { roughness: 0.93 },
    soil: { roughness: 0.95 },
    fabric: { roughness: 0.9 }, // cloth and fur stay dry: no sheen, no satin
    paint: { roughness: 0.8 }, // matte render, hoardings, paper, rubber
    water: { roughness: 0.3 },
    sand: { roughness: 0.95 },
    gravel: { roughness: 0.95 },
  };
  const spec = new Map<SurfaceKind, SpecUniform>();
  function specFor(kind: SurfaceKind) {
    let u = spec.get(kind);
    if (!u) {
      const up = finish[kind]?.spec ?? 1;
      spec.set(kind, (u = { value: new T.Vector2(up, finish[kind]?.specFloor ?? up) }));
    }
    return u;
  }
  /** Live tuning from the console: `__city.model.materialLibrary.setSpec('enamel', 1.2, 0.8)` (up, floor). */
  function setSpec(kind: SurfaceKind, up: number, floor = up) {
    specFor(kind).value.set(up, floor);
  }
  /** Each pattern's strength (1 as built), one array shared by every solid batch. */
  const surfaceGain: GainUniform = { value: Array.from({ length: PATTERNS }, () => 1) };
  /** Live tuning from the console: `__city.model.materialLibrary.setLook('brick', 0.5)` (strength; 0 plain). */
  function setLook(kind: SurfaceKind, strength: number) {
    const n = surfacePattern(kind);
    if (n) surfaceGain.value[n] = strength;
  }
  function material(colour: string, kind: SurfaceKind = 'stone') {
    if (kind === 'stone' && BRICK_COLOURS.has(colour.toLowerCase())) kind = 'brick';
    const key = `${kind}:${colour}`;
    if (!cache.has(key)) {
      const look = finish[kind] ?? { roughness: 0.7 };
      const options = {
        color: colour,
        roughness: look.roughness,
        metalness: look.metalness ?? 0,
        flatShading: false,
      };
      // Clear coat is a program switch: set once at build time, never toggled at run time.
      const m = look.clearcoat
        ? new T.MeshPhysicalMaterial({ ...options, clearcoat: look.clearcoat, clearcoatRoughness: look.clearcoatRoughness ?? 0 })
        : new T.MeshStandardMaterial(options);
      if ((look.spec ?? 1) !== 1 || (look.specFloor ?? 1) !== 1) specShader(m, specFor(kind));
      m.name = `city-${kind}`;
      m.userData.surfaceKind = kind;
      if (kind === 'glass') {
        m.emissive.set(GLASS_GLOW);
        m.emissiveIntensity = night * 0.72;
      } else if (kind === 'grass' || kind === 'soil') {
        if (!maps.has(kind)) maps.set(kind, surfaceMaps(kind));
        m.map = maps.get(kind)!.map;
      }
      cache.set(key, m);
    }
    return cache.get(key)!;
  }
  // Clones retain real maps/roughness/metalness and smooth geometric normals.
  const batches = new Map<string, T.MeshStandardMaterial>();
  function batchMaterial(source: T.MeshStandardMaterial, doubleSide: boolean) {
    const side = doubleSide ? T.DoubleSide : source.side,
      kind = (BATCH_KIND[source.userData.surfaceKind as SurfaceKind] ?? source.userData.surfaceKind) as SurfaceKind;
    const key = [
      kind || source.uuid,
      source.type,
      (source as T.MeshPhysicalMaterial).clearcoat ?? 0,
      side,
      source.transparent,
      source.opacity,
      source.roughness,
      source.metalness,
      source.emissive.getHex(),
      source.userData.surfaceKind === 'glass' ? 0 : source.emissiveIntensity,
      source.bumpScale,
      source.map?.uuid,
      source.bumpMap?.uuid,
      source.flatShading,
    ].join(':');
    if (!batches.has(key)) {
      const m = source.clone();
      m.color.set('#ffffff');
      m.vertexColors = true;
      m.side = side;
      if (kind) {
        m.userData.surfaceKind = kind;
        m.name = `city-${kind}`;
      }
      if (MASKED_GROUND.has(kind)) groundShader(m, kind, bakeUniforms);
      else if (!GROUND_KINDS.has(kind)) bakeShader(m, specFor(kind), surfaceGain, surfacePx, kind === 'glass', windowClock);
      batches.set(key, m);
    }
    return batches.get(key)!;
  }
  function dispose() {
    bakeUniforms.groundMasks.value.dispose();
    blank.dispose();
    for (const { map, bump } of maps.values()) {
      map.dispose();
      bump.dispose();
    }
    new Set([...cache.values(), ...batches.values()]).forEach((m) =>
      m.dispose(),
    );
  }
  function setNight(value: number) {
    night = value;
    for (const m of [...cache.values(), ...batches.values()])
      if (m.userData.surfaceKind === 'glass')
        m.emissiveIntensity = night * 0.72;
  }
  /** The renderer's pixel ratio, so the surface patterns fade by CSS pixels (see SURFACE_PARS). */
  function setPixelRatio(ratio: number) {
    surfacePx.value = Math.max(1, ratio);
  }
  /** Where the night is for the panes (glasgow-sun's windowClock, as followed by the scene). */
  function setWindows(out: number, wake: number) {
    windowClock.value.set(out, wake);
  }
  return { material, batchMaterial, dispose, setNight, setWindows, setSpec, setLook, setPixelRatio, bakeUniforms };
}

/*
 * JS twins of the window shader, for the checks. Keep them in step with WINDOW_VERTEX; `light` is
 * a pane's aWindow bytes / 255 (town.windows), `clock` the window clock.
 */
const ss = (e: number, x: number) => T.MathUtils.smoothstep(x, e, e + 0.002);
/** A pane's light level at this point of the night (0 dark, its own level, or 0.8 for an early riser). */
export function windowLevel(light: readonly number[], clock: { out: number; wake: number }) {
  return Math.max(light[0] * (1 - ss(light[2], clock.out)), light[3] < 0.999 ? 0.8 * ss(light[3], clock.wake) : 0);
}
/** The pane's emissive before emissiveIntensity (linear), i.e. emissive × vWindow. */
export function windowGlow(light: readonly number[], clock: { out: number; wake: number }) {
  const t = Math.round(light[1] * 255),
    glow = new T.Color(GLASS_GLOW);
  const c = t < 128 ? new T.Color(WINDOW_WARM).lerp(glow, t / 128) : glow.lerp(new T.Color(WINDOW_COOL), (t - 128) / 127);
  return c.multiplyScalar(windowLevel(light, clock));
}

/** UVs use physical dimensions, not one identical stretched texture per box. */
export function projectMaterialUV(
  geometry: T.BufferGeometry,
  kind?: SurfaceKind,
) {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal'),
    uv = new Float32Array(p.count * 2);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new T.Vector3());
  for (let i = 0; i < p.count; i++) {
    const a = Math.abs(n.getX(i)),
      b = Math.abs(n.getY(i)),
      c = Math.abs(n.getZ(i));
    let u = a > b && a > c ? p.getZ(i) : p.getX(i);
    let v = b > a && b > c ? p.getZ(i) : p.getY(i);
    if (
      (kind === 'wood' || kind === 'bark') &&
      (b > a && b > c ? size.z > size.x : size.y > Math.max(size.x, size.z))
    )
      [u, v] = [v, u];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
}
