import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/*
 * The selection ring's depth test, in numbers: both of its mask passes are built from them, and
 * check-hover holds them and runs the twins below on synthetic depths. A fragment of the selected
 * building counts as in front where its depth is at most the beauty pass's plus a slack: a fixed
 * bias, and INK_SLOPE times the depth's slope across the pixel (fwidth), since the beauty pass's
 * depth is one sample's, taken off the pixel centre (at most half a pixel away, so at least 0.5;
 * at most 4, or a lamp or a tree before the building no longer counts as in front).
 */
export const INK_BIAS = 0.000015;
export const INK_SLOPE = 2;
/**
 * The centre pass keeps a pixel where at least one of the test's samples passed: their resolve is
 * the share that did (1/samples for one), so anything over half of R8's smallest step counts.
 */
export const INK_KEEP = 0.5 / 255;
/** A number as a GLSL float literal: 2 is written `2.`, 0.000015 as it is. */
const glsl = (v: number) => (Number.isInteger(v) ? `${v}.` : String(v));
/**
 * The test both mask passes share, inFront(): the fragment against the beauty pass's depth, with
 * the slack worked out before any branch (derivatives need every pixel of the quad).
 */
export const INK_DEPTH_TEST = `uniform sampler2D sceneDepth; uniform vec2 resolution; bool inFront(){float slack=${glsl(INK_BIAS)}+${glsl(INK_SLOPE)}*fwidth(gl_FragCoord.z);return gl_FragCoord.z<=texture2D(sceneDepth,gl_FragCoord.xy/resolution).r+slack;}`;
/**
 * JS twin of inFront(), for the checks: `depth` the fragment's, `scene` the beauty pass's (both in
 * the depth buffer's 0 to 1) and `fwidth` the fragment depth's slope across the pixel.
 */
export const inkInFront = (depth: number, scene: number, fwidth: number) =>
  depth <= scene + (INK_BIAS + INK_SLOPE * fwidth);
/**
 * JS twin of the centre pass, for the checks: it keeps a pixel the building covers at its centre
 * where the centre is in front (`front`) or where the test's samples found it so (`tested`, their
 * resolve: 0, or at least 1/samples).
 */
export const inkKeeps = (front: boolean, tested: number) =>
  front || tested >= INK_KEEP;

/**
 * The final composite: a multisampled beauty pass, a soft vignette and the ring around a
 * selected building. No outlines and no screen-space occlusion: both drew ghost copies of
 * thin or floating shapes (posts, canopies). Contact darkening is baked into the model.
 * The depth-buffer approach began with AC's xi4u (MIT, see THIRD_PARTY_NOTICES.md).
 */
export function createCityInk(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.OrthographicCamera,
  samples = 4,
) {
  const target = new T.WebGLRenderTarget(1, 1, {
    type: T.HalfFloatType,
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter,
    samples: Math.min(samples, renderer.capabilities.maxSamples),
  });
  target.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
  let selected: T.Object3D[] = [],
    mask: T.WebGLRenderTarget | null = null,
    tested: T.WebGLRenderTarget | null = null,
    pixelWidth = 1,
    pixelHeight = 1;
  // The ring is drawn round a mask: the selected building's pixels where the beauty pass's depth
  // says it is in front. That depth is a multisampled buffer's resolve, one sample's depth taken
  // off the pixel centre, while the mask's fragments sit on the centre. So the tolerance grows
  // with the depth's slope across the pixel (fwidth): a fixed one failed on every face nearer at
  // that sample than at the centre, and the ring drew gold squiggles across the building's own
  // faces. And the test is drawn multisampled like the beauty pass, so a part that covers the
  // resolved sample but not the centre (a balcony before its wall, the coping before the lawn)
  // still has a fragment there to answer for its pixel. check-hover holds both (INK_DEPTH_TEST).
  const vertexShader =
    'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
  const maskMaterial = new T.ShaderMaterial({
    uniforms: {
      sceneDepth: { value: target.depthTexture },
      resolution: { value: new T.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader,
    fragmentShader: `${INK_DEPTH_TEST} void main(){if(!inFront())discard;gl_FragColor=vec4(1.);}`,
  });
  // Then the pixels whose centre the building covers (all the mask ever held, so the ring outside
  // the silhouette stays where it was) and where either the test's samples or the centre itself
  // (a sliver can cover the centre and no sample) found it in front.
  const keepMaterial = new T.ShaderMaterial({
    uniforms: {
      sceneDepth: maskMaterial.uniforms.sceneDepth,
      resolution: maskMaterial.uniforms.resolution,
      tested: { value: null as T.Texture | null },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader,
    fragmentShader: `${INK_DEPTH_TEST} uniform sampler2D tested; void main(){bool front=inFront();if(!front&&texture2D(tested,gl_FragCoord.xy/resolution).r<${glsl(INK_KEEP)})discard;gl_FragColor=vec4(1.);}`,
  });
  const material = new T.ShaderMaterial({
    uniforms: {
      colour: { value: target.texture },
      saturation: { value: 1 },

      selection: { value: target.texture },
      hasSelection: { value: 0 },
      selectionStep: { value: new T.Vector2() },
      selectionColor: { value: new T.Color('#f0b85a') },
    },
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    vertexShader:
      'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
      uniform sampler2D colour;
      uniform float saturation;
      uniform sampler2D selection; uniform float hasSelection; uniform vec2 selectionStep; uniform vec3 selectionColor;
      varying vec2 vUv;
      void main(){
        vec4 c=texture2D(colour,vUv);
        if(c.a<.00001){gl_FragColor=vec4(0.);return;}
        c.rgb/=c.a;
        // Colour grade: one saturation dial for the whole town, applied in linear light
        // before tone mapping, so sea, grass and buildings stay in proportion.
        c.rgb=max(mix(vec3(dot(c.rgb,vec3(.2126,.7152,.0722))),c.rgb,saturation),0.);
        gl_FragColor=c;
        float vignette=smoothstep(.5,1.08,length((vUv-.5)*vec2(1.08,1.))*1.38);
        gl_FragColor.rgb*=1.-.08*vignette;
        if(hasSelection>0.5){float center=texture2D(selection,vUv).r;float ring=0.;
          for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)ring=max(ring,texture2D(selection,vUv+vec2(float(x),float(y))*selectionStep).r);
          gl_FragColor.rgb=mix(gl_FragColor.rgb,selectionColor,max(0.,ring-center)*.95);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const quad = new FullScreenQuad(material);
  return {
    /** 1 keeps the palette as modelled; lower values mute every colour equally. */
    setSaturation(value: number) {
      material.uniforms.saturation.value = value;
    },
    setSelection(objects: T.Object3D[]) {
      selected = objects;
    },
    resize(width: number, height: number) {
      const dpr = renderer.getPixelRatio();
      pixelWidth = Math.max(1, Math.round(width * dpr));
      pixelHeight = Math.max(1, Math.round(height * dpr));
      mask?.setSize(pixelWidth, pixelHeight);
      tested?.setSize(pixelWidth, pixelHeight);
      maskMaterial.uniforms.resolution.value.set(pixelWidth, pixelHeight);
      // A one-pixel ring just outside the silhouette of the selected building.
      material.uniforms.selectionStep.value.set(
        1.05 / Math.max(width, 1),
        1.05 / Math.max(height, 1),
      );
      target.setSize(
        Math.max(1, Math.round(width * dpr)),
        Math.max(1, Math.round(height * dpr)),
      );

    },
    /**
     * Compile the scene's shaders as the beauty pass draws them (into its own target) without
     * drawing, the slow part done in the background where the browser can.
     */
    compile() {
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        return renderer.compileAsync(scene, camera);
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    render() {
      // The beauty depth already respects transparent smoke.
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        material.uniforms.hasSelection.value = selected.length ? 1 : 0;
        if (selected.length) {
          if (!mask || !tested) {
            // One channel: the composite reads only whether the building is there.
            mask = new T.WebGLRenderTarget(pixelWidth, pixelHeight, {
              format: T.RedFormat,
              depthBuffer: false,
              minFilter: T.NearestFilter,
              magFilter: T.NearestFilter,
            });
            // As many samples as the beauty pass, in one channel: it only holds which passed.
            tested = new T.WebGLRenderTarget(pixelWidth, pixelHeight, {
              samples: target.samples,
              format: T.RedFormat,
              depthBuffer: false,
              minFilter: T.NearestFilter,
              magFilter: T.NearestFilter,
            });
            keepMaterial.uniforms.tested.value = tested.texture;
          }
          const savedLayers = camera.layers.mask,
            savedOverride = scene.overrideMaterial,
            savedBackground = scene.background,
            savedShadow = renderer.shadowMap.autoUpdate;
          const changed: T.Object3D[] = [];
          const clear = renderer.getClearColor(new T.Color()),
            alpha = renderer.getClearAlpha();
          try {
            selected.forEach((root) =>
              root.traverseVisible((o) => {
                if (o instanceof T.Mesh && !o.layers.isEnabled(31)) {
                  o.layers.enable(31);
                  changed.push(o);
                }
              }),
            );
            camera.layers.set(31);
            scene.background = null;
            renderer.shadowMap.autoUpdate = false;
            renderer.setClearColor(0, 0);
            scene.overrideMaterial = maskMaterial;
            renderer.setRenderTarget(tested);
            renderer.clear();
            renderer.render(scene, camera);
            scene.overrideMaterial = keepMaterial;
            renderer.setRenderTarget(mask);
            renderer.clear();
            renderer.render(scene, camera);
            material.uniforms.selection.value = mask.texture;
          } finally {
            changed.forEach((o) => o.layers.disable(31));
            camera.layers.mask = savedLayers;
            scene.overrideMaterial = savedOverride;
            scene.background = savedBackground;
            renderer.shadowMap.autoUpdate = savedShadow;
            renderer.setClearColor(clear, alpha);
          }
        }
        renderer.setRenderTarget(previous);
        quad.render(renderer);
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    dispose() {
      target.depthTexture?.dispose();
      target.dispose();
      mask?.dispose();
      tested?.dispose();
      maskMaterial.dispose();
      keepMaterial.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}
