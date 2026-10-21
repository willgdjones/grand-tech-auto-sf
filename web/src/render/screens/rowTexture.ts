import {
  DataTexture,
  FloatType,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  RGBAIntegerFormat,
  RedIntegerFormat,
  SRGBColorSpace,
  UnsignedByteType,
  UnsignedIntType,
  UnsignedShortType,
} from 'three';
import type { WebGLRenderer } from 'three';
import { DirtyRows } from './dirtyRows';

/**
 * A screen data table: a CPU mirror, a `DataTexture` with an explicit sized internal format, and dirty-row
 * uploads. The first upload is three's own full `texStorage2D`/`texSubImage2D`; later frames upload only the
 * dirty row runs through raw `texSubImage2D`, then reset three's GL state cache. three's DataTexture update
 * ranges are RGBA-only, so they cannot serve the single-channel integer tables.
 */
export const TABLE_LAYOUTS = {
  R32UI: {
    channels: 1,
    format: RedIntegerFormat,
    type: UnsignedIntType,
    gl: ['RED_INTEGER', 'UNSIGNED_INT'],
  },
  RGBA16UI: {
    channels: 4,
    format: RGBAIntegerFormat,
    type: UnsignedShortType,
    gl: ['RGBA_INTEGER', 'UNSIGNED_SHORT'],
  },
  R8UI: {
    channels: 1,
    format: RedIntegerFormat,
    type: UnsignedByteType,
    gl: ['RED_INTEGER', 'UNSIGNED_BYTE'],
  },
  RGBA32F: { channels: 4, format: RGBAFormat, type: FloatType, gl: ['RGBA', 'FLOAT'] },
  SRGB8_ALPHA8: { channels: 4, format: RGBAFormat, type: UnsignedByteType, gl: ['RGBA', 'UNSIGNED_BYTE'] },
  RGBA8: { channels: 4, format: RGBAFormat, type: UnsignedByteType, gl: ['RGBA', 'UNSIGNED_BYTE'] },
} as const;
export type TableFormat = keyof typeof TABLE_LAYOUTS;
interface TableArrays {
  R32UI: Uint32Array;
  RGBA16UI: Uint16Array;
  R8UI: Uint8Array;
  RGBA32F: Float32Array;
  SRGB8_ALPHA8: Uint8Array;
  RGBA8: Uint8Array;
}

export class RowTexture<F extends TableFormat> {
  readonly texture: DataTexture;
  readonly dirty: DirtyRows;
  readonly channels: number;
  private uploadContext: WebGL2RenderingContext | undefined;
  private uploadedRows = 0;
  /** Reuse this visitor so changed tint/table rows do not create a closure every frame. */
  private readonly uploadRows = (first: number, count: number): void => {
    const gl = this.uploadContext!;
    const [format, type] = TABLE_LAYOUTS[this.internalFormat].gl;
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      first,
      this.width,
      count,
      gl[format],
      gl[type],
      this.data,
      first * this.width * this.channels,
    );
    this.uploadedRows += count;
  };
  constructor(
    readonly name: string,
    readonly internalFormat: F,
    readonly data: TableArrays[F],
    readonly width: number,
    readonly height: number,
  ) {
    const layout = TABLE_LAYOUTS[internalFormat];
    this.channels = layout.channels;
    if (data.length !== width * height * layout.channels) throw new RangeError(`TABLE_SIZE: ${name}`);
    this.texture = new DataTexture(data, width, height, layout.format, layout.type);
    this.texture.name = name;
    this.texture.internalFormat = internalFormat;
    this.texture.colorSpace = internalFormat === 'SRGB8_ALPHA8' ? SRGBColorSpace : NoColorSpace;
    this.texture.magFilter = this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true; // version 1: three's first use allocates and uploads the mirror
    this.dirty = new DirtyRows(height);
    this.dirty.markAll(); // the first upload() allocates and fills the whole texture
  }
  get bytes(): number {
    return this.data.byteLength;
  }
  /** Marks the rows holding texels `first…last` (texel indices, inclusive). */
  markTexels(first: number, last = first): void {
    this.dirty.mark(Math.floor(first / this.width), Math.floor(last / this.width));
  }
  /** Once per frame before render. Returns the rows uploaded (the full height on first use). */
  upload(renderer: WebGLRenderer): number {
    if (!this.dirty.pending) return 0;
    const handle = (renderer.properties.get(this.texture) as { __webglTexture?: WebGLTexture })
      .__webglTexture;
    if (!handle) {
      // First use: three allocates immutable storage and uploads the whole mirror.
      renderer.initTexture(this.texture);
      this.dirty.clear();
      return this.height;
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    renderer.state.bindTexture(gl.TEXTURE_2D, handle);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    this.uploadContext = gl;
    this.uploadedRows = 0;
    try {
      this.dirty.flush(this.uploadRows);
      return this.uploadedRows;
    } finally {
      this.uploadContext = undefined;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      renderer.resetState();
    }
  }
  dispose(): void {
    this.texture.dispose();
  }
}
