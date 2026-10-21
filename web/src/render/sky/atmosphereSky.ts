// Graphics v2 phase 2, item 6 (docs/engineering/graphics-v2-phase2.md): a physically based sky from takram
// three-geospatial / three-atmosphere (MIT, https://github.com/takram-design-engineering/three-geospatial),
// used as a library (attribution in PROVENANCE.md). HD only, lazy-loaded so Low/phone never download it.
// The SA grade still runs on top in post.ts; our own dome becomes a clouds/stars overlay (sky.ts).
import { Color, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Scene, UnsignedByteType, Vector3, WebGLRenderTarget, type Camera, type WebGLRenderer } from 'three';
import type { TimeGrade } from '../timeGrade';

/** Map origin (manifest frame): 37.7842 N, -122.4078 E. */
const ORIGIN = { lat: 37.7842, lon: -122.4078 };
/** Exposure for the radiance → display curve (no HDR target in the ps2 path). Tuned by eye at noon/golden. */
const EXPOSURE = 6.0;

export interface AtmosphereSky {
  mesh: Mesh;
  applyGrade(grade: TimeGrade): void;
  /** Aerial-perspective lite: the physical sky's colour at the horizon in the view direction (linear). */
  horizonColour(view: Camera, out: Color): Color;
  /** Shared with the full AerialPerspectiveEffect (gtasf-kpi9): precomputed textures, frame and ECEF sun. */
  readonly shared: { textures: Record<string, unknown>; worldToECEFMatrix: Matrix4; sunDirection: Vector3 };
  dispose(): void;
}

/** Resolves once the precomputed scattering textures are ready; undefined if anything fails (keep the dome). */
export async function loadAtmosphereSky(renderer: WebGLRenderer): Promise<AtmosphereSky | undefined> {
  try {
    const [{ SkyMaterial, PrecomputedTexturesGenerator }, { Ellipsoid, Geodetic, radians }] = await Promise.all([
      import('@takram/three-atmosphere'), import('@takram/three-geospatial'),
    ]);
    // ground: false — below-horizon rays (from Lombard or any hill, past the loaded chunks) would otherwise hit
    // takram's dark planet surface and read as a BLACK band on the horizon (preview review). Sky continues instead.
    const material = new SkyMaterial({ ground: false });
    // Our frame is +x east, +y up, +z south. ECEF via the east-north-up frame at the map origin.
    const positionECEF = new Geodetic(radians(ORIGIN.lon), radians(ORIGIN.lat), 0).toECEF();
    const enu = Ellipsoid.WGS84.getEastNorthUpFrame(positionECEF);
    const toEnu = new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, -1, 0));
    material.worldToECEFMatrix.copy(enu).multiply(toEnu);
    // No tone mapping in this path: compress radiance with a soft exposure curve, and write alpha 0 (our
    // offscreen colour target uses alpha 0 as the sky mask that keeps bloom off the sky).
    material.fragmentShader = material.fragmentShader.replace('outputColor.a = 1.0;',
      `outputColor.rgb = vec3(1.0) - exp(-outputColor.rgb * ${EXPOSURE.toFixed(2)});\n  outputColor.a = 0.0;`);
    const generator = new PrecomputedTexturesGenerator(renderer);
    await generator.update();
    Object.assign(material, generator.textures);
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.name = 'Atmosphere sky'; mesh.frustumCulled = false; mesh.renderOrder = -1001;
    const rotation = new Matrix4().extractRotation(material.worldToECEFMatrix), sun = new Vector3();
    // A tiny offscreen render of the same sky, looking at the horizon, read back on grade changes only.
    const probeTarget = new WebGLRenderTarget(8, 1, { type: UnsignedByteType, depthBuffer: false });
    const probeCamera = new PerspectiveCamera(70, 8, 0.1, 10), probeScene = new Scene(), probeMesh = new Mesh(mesh.geometry, material);
    probeMesh.frustumCulled = false; probeScene.add(probeMesh);
    const pixels = new Uint8Array(8 * 4), forward = new Vector3();
    return {
      mesh,
      shared: { textures: generator.textures as unknown as Record<string, unknown>, worldToECEFMatrix: material.worldToECEFMatrix, sunDirection: material.sunDirection },
      applyGrade(grade) {
        // The art-directed grade owns the sun (time override, golden hour); rotate it into ECEF.
        material.sunDirection.copy(sun.copy(grade.sunDirection).applyMatrix4(rotation).normalize());
      },
      horizonColour(view, out) {
        view.getWorldDirection(forward); forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        view.getWorldPosition(probeCamera.position);
        probeCamera.lookAt(probeCamera.position.clone().add(forward.normalize()).add(new Vector3(0, 0.03, 0)));
        probeCamera.updateMatrixWorld();
        const previous = renderer.getRenderTarget();
        try { renderer.setRenderTarget(probeTarget); renderer.render(probeScene, probeCamera); renderer.readRenderTargetPixels(probeTarget, 0, 0, 8, 1, pixels); }
        finally { renderer.setRenderTarget(previous); }
        let r = 0, g = 0, b = 0; for (let i = 0; i < 8; i++) { r += pixels[i * 4]!; g += pixels[i * 4 + 1]!; b += pixels[i * 4 + 2]!; }
        return out.setRGB(r / 2040, g / 2040, b / 2040);
      },
      dispose() { mesh.geometry.dispose(); material.dispose(); generator.dispose(); probeTarget.dispose(); },
    };
  } catch { return undefined; }
}
