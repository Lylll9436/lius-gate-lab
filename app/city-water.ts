// Water surface adapted from AC / xi4u (MIT). See THIRD_PARTY_NOTICES.md.
import * as T from 'three';

function createCreekMaterial() {
  const uniforms = {
    time: { value: 0 },
    night: { value: 0 },
    rain: { value: 0 },
    cloud: { value: 0 },
    eyeDirection: { value: new T.Vector3(0.46, 0.55, 0.69) },
    moonPosition: { value: new T.Vector3(-160, 320, 200) },
  };
  // Local lamps illuminate the bank; their specular lobes do not become glowing water pillars.
  const material = new T.MeshPhysicalMaterial({
    color: '#77aead',
    roughness: 0.85,
    metalness: 0,
    specularIntensity: 0,
    clearcoat: 0,
    transparent: true,
    opacity: 0.64,
    side: T.DoubleSide,
    depthWrite: false,
  });
  material.forceSinglePass = true;
  material.name = 'island-moonlit-water';
  material.userData.surfaceKind = 'water';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      'varying vec3 creekWorldP; uniform float time;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
   vec2 p=position.xz;
   transformed.y+=sin(dot(p,vec2(2.3,1.1))-time*.9)*.005+sin(dot(p,vec2(-3.1,4.7))+time*.73)*.003+sin(dot(p,vec2(8.2,5.4))-time*1.3)*.0015;
   creekWorldP=(modelMatrix*vec4(transformed,1.)).xyz;`,
    );
    shader.fragmentShader =
      `varying vec3 creekWorldP; uniform float time; uniform float night; uniform float rain; uniform float cloud; uniform vec3 eyeDirection; uniform vec3 moonPosition;
   float creekHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float creekNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(creekHash(i),creekHash(i+vec2(1.,0.)),f.x),mix(creekHash(i+vec2(0.,1.)),creekHash(i+vec2(1.,1.)),f.x),f.y);}
   vec3 creekNormal(vec2 p){
    vec2 slope=cos(dot(p,vec2(2.3,1.1))-time*.9)*.005*vec2(2.3,1.1)+cos(dot(p,vec2(-3.1,4.7))+time*.73)*.003*vec2(-3.1,4.7)+cos(dot(p,vec2(8.2,5.4))-time*1.3)*.0015*vec2(8.2,5.4);
    slope+=cos(dot(p,vec2(19.3,-11.8))+time*1.8)*(.001+rain*.0011)*vec2(19.3,-11.8);
    return normalize(vec3(-slope.x,1.,-slope.y));
   }
  ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
   vec2 waterP=creekWorldP.xz;
   vec3 waveNormal=creekNormal(waterP);
   float flow=creekNoise(waterP*3.2+vec2(time*.06,-time*.16));
   float fine=creekNoise(waterP*11.7+vec2(-time*.17,time*.23));
   float smallRipple=smoothstep(.62,.87,flow)*smoothstep(.59,.78,fine);
   diffuseColor.rgb*=mix(vec3(.93,1.,1.),vec3(.38,.62,.82),night);
   diffuseColor.rgb+=vec3(.025,.065,.06)*smallRipple*(1.-night*.8);
   diffuseColor.a=.61+smallRipple*.045;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
   normal=normalize((viewMatrix*vec4(waveNormal,0.)).xyz);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
   vec3 toMoon=normalize(moonPosition-creekWorldP);
   vec3 halfMoon=normalize(toMoon+normalize(eyeDirection));
   float alignment=max(0.,dot(waveNormal,halfMoon));
   float flecks=creekNoise(creekWorldP.xz*vec2(8.,19.)+vec2(time*.2,-time*.45));
   float brokenGlint=mix(.13,1.,smoothstep(.38,.77,flecks));
   float reflection=(pow(alignment,150.)*.32+pow(alignment,48.)*.025)*brokenGlint;
   float fresnel=.05+.18*pow(1.-max(0.,dot(waveNormal,normalize(eyeDirection))),4.);
   totalEmissiveRadiance+=night*(1.-cloud*.85)*vec3(.48,.65,.86)*(reflection+fresnel*.1);
  `,
    );
  };
  return { material, uniforms };
}

export function createIslandWater() {
  const { material, uniforms } = createCreekMaterial();
  const geometry = new T.PlaneGeometry(320, 320, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  // Wave shape is in the fragment normals; a flat ocean mesh avoids coarse waves at the horizon.
  material.onBeforeCompile = ((original) => (shader) => {
    original(shader, null as unknown as T.WebGLRenderer);
    shader.vertexShader = shader.vertexShader.replace(
      /transformed.y\+=.*?;/,
      '',
    );
  })(material.onBeforeCompile.bind(material));
  material.customProgramCacheKey = () => 'lius-island-water-v1';
  const mesh = new T.Mesh(geometry, material);
  mesh.position.y = 0.0725;
  mesh.name = 'island-sea';
  mesh.renderOrder = 2;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  const bottom = new T.Mesh(
    new T.PlaneGeometry(320, 320),
    new T.MeshBasicMaterial({ color: '#659998', depthWrite: false }),
  );
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -0.38;
  bottom.name = 'sea-colour-bed';
  bottom.renderOrder = -2;
  const dayBed = new T.Color('#659998'),
    nightBed = new T.Color('#172f42');
  return {
    mesh,
    bottom,
    update(time: number, night: number, camera: T.Camera) {
      bottom.material.color.copy(dayBed).lerp(nightBed, night);
      uniforms.time.value = time;
      uniforms.night.value = night;
      camera.getWorldDirection(uniforms.eyeDirection.value).negate();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      bottom.geometry.dispose();
      bottom.material.dispose();
    },
  };
}
