import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { WebGLRenderer } from 'three';
import { ATLAS_BYTES_PER_TEXEL, ATLAS_LAYERS, ATLAS_PAGE_EDGE } from '@gtasf/shared/constants';
import type { MemoryHandle, MemoryLedger, MemoryTier } from '../../perf/memoryLedger';
import type { AtlasRect } from './freeRectAllocator';

export interface AtlasTextureRegion extends AtlasRect {
  readonly layer: number;
}

function layerCount(tier: MemoryTier, layers: number): void {
  if (layers !== 1 && layers !== ATLAS_LAYERS[tier]) throw new RangeError('ATLAS_LAYER_COUNT');
}

/** One null-data array, including its scratch layer. Repack never creates another array. */
export class AtlasTexture {
  private array!: DataArrayTexture;
  private memory: MemoryHandle | undefined;
  private framebuffer: WebGLFramebuffer | null = null;
  private renderer: WebGLRenderer | undefined;
  private present = false;
  private lost = false;
  private disposed = false;
  private serial = 0;
  private depth: number;
  private tier: MemoryTier;

  constructor(
    private readonly ledger: MemoryLedger,
    tier: MemoryTier,
    layers: number = ATLAS_LAYERS[tier],
  ) {
    layerCount(tier, layers);
    this.depth = layers;
    this.tier = tier;
    this.create();
  }

  get texture(): DataArrayTexture {
    return this.array;
  }
  get layers(): number {
    return this.depth;
  }
  get generation(): number {
    return this.serial;
  }
  get bytes(): number {
    return this.present ? ATLAS_PAGE_EDGE ** 2 * this.depth * ATLAS_BYTES_PER_TEXEL : 0;
  }
  get contextLost(): boolean {
    return this.lost;
  }

  private create(): void {
    this.memory = this.ledger.register(
      'atlas',
      'atlas:array',
      ATLAS_PAGE_EDGE ** 2 * this.depth * ATLAS_BYTES_PER_TEXEL,
      { domain: 'gpu' },
    );
    try {
      this.array = new DataArrayTexture(null, ATLAS_PAGE_EDGE, ATLAS_PAGE_EDGE, this.depth);
      this.array.name = 'uAtlas';
      this.array.internalFormat = 'SRGB8_ALPHA8';
      this.array.format = RGBAFormat;
      this.array.type = UnsignedByteType;
      this.array.colorSpace = SRGBColorSpace;
      this.array.minFilter = this.array.magFilter = LinearFilter;
      this.array.wrapS = this.array.wrapT = ClampToEdgeWrapping;
      this.array.generateMipmaps = false;
      this.array.flipY = false;
      this.array.unpackAlignment = 1;
      // three allocates texStorage3D but must not call texSubImage3D with a null CPU source.
      this.array.source.dataReady = false;
      this.array.needsUpdate = true; // Only creation; all subsequent writers use raw strips/copies.
      this.present = true;
      this.serial++;
    } catch (error) {
      this.ledger.release(this.memory);
      this.memory = undefined;
      throw error;
    }
  }

  /** Initialize before frame work; it never makes a page-sized CPU backing buffer. */
  initialize(renderer: WebGLRenderer): void {
    if (this.disposed || this.lost) throw new Error('ATLAS_TEXTURE_UNAVAILABLE');
    if (this.renderer && this.renderer !== renderer) throw new Error('ATLAS_RENDERER_MISMATCH');
    this.renderer = renderer;
    try {
      renderer.initTexture(this.array);
      const gl = renderer.getContext();
      if (!this.handle() || gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
        throw new Error('ATLAS_TEXTURE_ALLOCATION');
    } catch (error) {
      this.loseContext();
      throw error;
    }
  }

  /** The uploader still has to check allocation and texture generations before every strip. */
  handle(): WebGLTexture | null {
    if (!this.renderer || this.disposed || this.lost || !this.present) return null;
    return (
      (this.renderer.properties.get(this.array) as { __webglTexture?: WebGLTexture }).__webglTexture ?? null
    );
  }

  private checkRegion(region: AtlasTextureRegion): void {
    for (const n of [region.layer, region.x, region.y, region.w, region.h])
      if (!Number.isSafeInteger(n)) throw new RangeError('ATLAS_COPY_RECT');
    if (
      region.layer < 0 ||
      region.layer >= this.depth ||
      region.x < 0 ||
      region.y < 0 ||
      region.w < 1 ||
      region.h < 1 ||
      region.x + region.w > ATLAS_PAGE_EDGE ||
      region.y + region.h > ATLAS_PAGE_EDGE
    )
      throw new RangeError('ATLAS_COPY_RECT');
  }

  /**
   * Copy between disjoint layers of the same array. Unsupported devices return false so the page
   * manager can borrow a bitmap and use its registered budgeted reuploader. Raw temporary bindings
   * are restored exactly, leaving three's binding cache valid without resetting the live target.
   */
  copy(source: AtlasTextureRegion, target: AtlasTextureRegion): boolean {
    this.checkRegion(source);
    this.checkRegion(target);
    if (source.layer === target.layer || source.w !== target.w || source.h !== target.h)
      throw new RangeError('ATLAS_COPY_LAYERS');
    const handle = this.handle();
    if (!this.renderer || !handle) return false;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl.isContextLost()) return false;
    this.framebuffer ??= gl.createFramebuffer();
    if (!this.framebuffer) return false;
    const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousArray = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture | null;
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, handle, 0, source.layer);
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
      gl.copyTexSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        target.x,
        target.y,
        target.layer,
        source.x,
        source.y,
        source.w,
        source.h,
      );
      return gl.getError() === gl.NO_ERROR && !gl.isContextLost();
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, previousArray);
    }
  }

  private releaseGpu(): void {
    if (this.framebuffer && this.renderer) this.renderer.getContext().deleteFramebuffer(this.framebuffer);
    this.framebuffer = null;
    if (this.present) {
      this.array.dispose();
      this.present = false;
    }
    if (this.memory !== undefined) {
      this.ledger.release(this.memory);
      this.memory = undefined;
    }
    this.renderer = undefined;
  }

  loseContext(): void {
    if (this.disposed || this.lost) return;
    this.lost = true;
    this.serial++;
    this.releaseGpu();
  }

  /** Old storage is disposed and uncharged before replacement, also on a tier drop. */
  restore(
    renderer?: WebGLRenderer,
    tier = this.tier,
    layers: number = tier === this.tier ? this.depth : ATLAS_LAYERS[tier],
  ): void {
    if (this.disposed) throw new Error('ATLAS_TEXTURE_DISPOSED');
    layerCount(tier, layers);
    this.releaseGpu();
    this.tier = tier;
    this.depth = layers;
    this.lost = false;
    try {
      this.create();
      if (renderer) this.initialize(renderer);
    } catch (error) {
      this.loseContext();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseGpu();
  }
}
