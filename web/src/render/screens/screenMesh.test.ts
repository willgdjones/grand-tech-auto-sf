import { expect, it, vi } from 'vitest';
import { Group, SRGBColorSpace, Texture } from 'three';
import { MASTER_MAX_PIXELS } from '@gtasf/shared/constants';
import { masterDims } from '@gtasf/shared/master';
import { prepareWorldGeometry } from '../foundation';
import { createBillboard, createCreativeTexture } from './screenMesh';

it('rejects oversized decoded creatives without applying the master limit to atlas pages', () => {
  // Only dimensions are read at this boundary; no browser decode/upload is mocked.
  const image = (width: number, height: number) => ({ width, height }) as HTMLCanvasElement;
  expect(() => createCreativeTexture(image(2048, 1024))).toThrow('CREATIVE_PIXEL_LIMIT');
  expect(() => createCreativeTexture(image(0, 1024))).toThrow('CREATIVE_PIXEL_LIMIT');
  const texture = createCreativeTexture(image(1024, 1024));
  expect(texture.colorSpace).toBe(SRGBColorSpace); texture.dispose();
  expect(MASTER_MAX_PIXELS).toBe(1_048_576);
  for (const [cols, rows] of [[255, 255], [255, 1], [10, 20]]) {
    const size = masterDims(cols!, rows!);
    expect(size.width * size.height).toBeLessThanOrEqual(MASTER_MAX_PIXELS);
  }
});

it('billboards retain their low-gain shader and borrowed texture during world adaptation', () => {
  const atlas = new Texture(), board = createBillboard(8, 4, atlas), shader = board.material;
  const dispose = vi.spyOn(atlas, 'dispose'), group = new Group(); group.add(board);
  const restore = prepareWorldGeometry(group);
  expect(board.material).toBe(shader);
  expect(shader.uniforms.gain!.value).toBe(0.8);
  expect(shader.fog).toBe(true);
  restore(); board.geometry.dispose(); shader.dispose();
  expect(dispose).not.toHaveBeenCalled(); atlas.dispose();
});

it('rejects invalid board dimensions and UV rectangles before allocating geometry', () => {
  const atlas = new Texture();
  expect(() => createBillboard(0, 4, atlas)).toThrow('BILLBOARD_SIZE');
  expect(() => createBillboard(8, 4, atlas, [0.8, 0, 0.5, 1])).toThrow('BILLBOARD_ATLAS_RECT');
  expect(() => createBillboard(8, 4, atlas, [NaN, 0, 1, 1])).toThrow('BILLBOARD_ATLAS_RECT');
  atlas.dispose();
});
