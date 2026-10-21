import { TILE_ROW } from './constants';
import { RowTexture } from './rowTexture';

/** Display-only prices, indexed exactly like uTileState. Publication is atomic between frames. */
export class HeatTexture {
  readonly table: RowTexture<'R8UI'>;
  constructor(readonly cells: number) {
    if (!Number.isSafeInteger(cells) || cells < 1 || cells >= 2 ** 24) throw new RangeError('HEAT_CELLS');
    const height = Math.ceil(cells / TILE_ROW);
    this.table = new RowTexture('uHeat', 'R8UI', new Uint8Array(TILE_ROW * height), TILE_ROW, height);
  }
  publish(indices: Uint8Array): void {
    if (indices.length !== this.cells) throw new RangeError('HEAT_SIZE');
    for (let first = 0; first < this.cells; first += TILE_ROW) {
      const end = Math.min(this.cells, first + TILE_ROW);
      let changed = false;
      for (let cell = first; cell < end; cell++)
        if (this.table.data[cell] !== indices[cell]) {
          this.table.data[cell] = indices[cell]!;
          changed = true;
        }
      if (changed) this.table.markTexels(first);
    }
  }
  clear(): void {
    for (let first = 0; first < this.table.data.length; first += TILE_ROW) {
      let changed = false;
      for (let cell = first; cell < first + TILE_ROW; cell++)
        if (this.table.data[cell] !== 0) {
          this.table.data[cell] = 0;
          changed = true;
        }
      if (changed) this.table.markTexels(first);
    }
  }
}
