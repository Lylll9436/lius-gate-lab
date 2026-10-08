import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// The slope-corrected depth contour method is adapted from AC's xi4u (MIT).
// See THIRD_PARTY_NOTICES.md. Native resolution; no pixel enlargement or blur.
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
    pixelWidth = 1,
    pixelHeight = 1;
  const maskMaterial = new T.ShaderMaterial({
    uniforms: {
      sceneDepth: { value: target.depthTexture },
      resolution: { value: new T.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader:
      'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:
      'uniform sampler2D sceneDepth; uniform vec2 resolution; void main(){float z=texture2D(sceneDepth,gl_FragCoord.xy/resolution).r;if(gl_FragCoord.z>z+0.000015)discard;gl_FragColor=vec4(1.);}',
  });
  const material = new T.ShaderMaterial({
    uniforms: {
      colour: { value: target.texture },
      depth: { value: target.depthTexture },
      texel: { value: new T.Vector2(1, 1) },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      ink: { value: new T.Color('#233d39') },
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
      uniform sampler2D colour,depth;
      uniform vec2 texel;
      uniform float cameraNear,cameraFar;
      uniform vec3 ink;
      uniform sampler2D selection; uniform float hasSelection; uniform vec2 selectionStep; uniform vec3 selectionColor;
      varying vec2 vUv;
      float distanceAt(vec2 uv){return cameraNear+texture2D(depth,uv).r*(cameraFar-cameraNear);}
      float edge(vec2 direction,float center){
        vec2 offset=direction*texel;
        float ahead=distanceAt(vUv+offset);
        float behind=distanceAt(vUv-offset);
        float continuation=max(0.,center-behind);
        float jump=max(0.,ahead-center-continuation*1.4);
        return smoothstep(.045,.16,jump);
      }
      void main(){
        vec4 c=texture2D(colour,vUv);
        if(c.a<.00001){gl_FragColor=vec4(0.);return;}
        c.rgb/=c.a;
        float d=distanceAt(vUv);
        float line=max(max(edge(vec2(1.,0.),d),edge(vec2(-1.,0.),d)),max(edge(vec2(0.,1.),d),edge(vec2(0.,-1.),d)));
        gl_FragColor=vec4(mix(c.rgb,min(c.rgb,ink),line*.68),c.a);
        float vignette=smoothstep(.5,1.08,length((vUv-.5)*vec2(1.08,1.))*1.38);
        gl_FragColor.rgb*=1.-.14*vignette;
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
    setSelection(objects: T.Object3D[]) {
      selected = objects;
    },
    resize(width: number, height: number) {
      const dpr = renderer.getPixelRatio();
      pixelWidth = Math.max(1, Math.round(width * dpr));
      pixelHeight = Math.max(1, Math.round(height * dpr));
      mask?.setSize(pixelWidth, pixelHeight);
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
      material.uniforms.texel.value.set(
        0.8 / Math.max(width, 1),
        0.8 / Math.max(height, 1),
      );
    },
    render() {
      // The beauty depth already respects cutaway planes, transparent smoke and roof docking.
      const previous = renderer.getRenderTarget();
      try {
        material.uniforms.cameraNear.value = camera.near;
        material.uniforms.cameraFar.value = camera.far;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        material.uniforms.hasSelection.value = selected.length ? 1 : 0;
        if (selected.length) {
          if (!mask)
            mask = new T.WebGLRenderTarget(pixelWidth, pixelHeight, {
              depthBuffer: false,
              minFilter: T.NearestFilter,
              magFilter: T.NearestFilter,
            });
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
            scene.overrideMaterial = maskMaterial;
            scene.background = null;
            renderer.shadowMap.autoUpdate = false;
            renderer.setClearColor(0, 0);
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
      maskMaterial.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}
