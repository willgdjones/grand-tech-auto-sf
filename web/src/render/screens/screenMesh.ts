import { Mesh, PlaneGeometry, ShaderMaterial, SRGBColorSpace, Texture, UniformsLib, UniformsUtils } from 'three';
import { MASTER_MAX_PIXELS } from '@gtasf/shared/constants';

/** Creative sources are capped before entering GPU upload. Atlas pages have their own larger budget. */
export function createCreativeTexture(image: HTMLCanvasElement | HTMLImageElement | ImageBitmap): Texture {
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MASTER_MAX_PIXELS)
    throw new RangeError('CREATIVE_PIXEL_LIMIT');
  const texture = new Texture(image);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** BDTS preview/atlas sampling adapted to one weekly creative per whole surface. */
export function createBillboard(width: number, height: number, atlas: Texture, rect = [0, 0, 1, 1]) {
  if (!Number.isFinite(width * height) || width <= 0 || height <= 0) throw new RangeError('BILLBOARD_SIZE');
  if (rect.length !== 4 || !rect.every(Number.isFinite) || rect[0]! < 0 || rect[1]! < 0 || rect[2]! <= 0 || rect[3]! <= 0 || rect[0]! + rect[2]! > 1 || rect[1]! + rect[3]! > 1)
    throw new RangeError('BILLBOARD_ATLAS_RECT');
  atlas.colorSpace = SRGBColorSpace;
  const material = new ShaderMaterial({
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog!), atlas: { value: atlas }, rect: { value: rect }, gain: { value: 0.8 } },
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D atlas; uniform vec4 rect; uniform float gain; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() { gl_FragColor = vec4(texture2D(atlas, rect.xy + vUv * rect.zw).rgb * gain, 1.0);
      #include <colorspace_fragment>
      #include <fog_fragment>
      }`,
    toneMapped: false, fog: true,
  });
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.userData.gtasfBillboard = true;
  return mesh;
}
