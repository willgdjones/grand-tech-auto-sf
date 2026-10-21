import { Reader, Writer } from './bytes';
import { RESUME_TOKEN_BYTES, WORLD_MAX_CM, WORLD_MIN_CM } from './constants';
import type { Point } from './types';

export function readString(r: Reader, max: number, wide = false): string {
  const length = wide ? r.u16() : r.u8();
  if (length > max) r.fail('OUT_OF_RANGE');
  return r.utf8(length);
}
export function validResumeToken(token: string): boolean { return /^[0-9a-f]{64}$/.test(token); }
export function readToken(r: Reader, optional = false): string {
  const token = readString(r, RESUME_TOKEN_BYTES);
  if (!(optional && token === '') && !validResumeToken(token)) r.fail('OUT_OF_RANGE');
  return token;
}
export function writeToken(w: Writer, token: string, optional = false): void {
  if (!(optional && token === '') && !validResumeToken(token)) throw new RangeError('INVALID_RESUME_TOKEN');
  w.str8(token, RESUME_TOKEN_BYTES);
}
export function readEnum<T extends string>(r: Reader, values: readonly T[]): T {
  const value = values[r.u8()];
  if (value === undefined) r.fail('OUT_OF_RANGE');
  return value ?? values[0]!;
}
export function writeEnum<T extends string>(w: Writer, value: T, values: readonly T[]): void {
  const index = values.indexOf(value);
  if (index < 0) throw new RangeError('INVALID_ENUM');
  w.u8(index);
}
export function readBool(r: Reader): boolean {
  const value = r.u8();
  if (value > 1) r.fail('OUT_OF_RANGE');
  return value === 1;
}
export function writeBool(w: Writer, value: boolean): void {
  if (typeof value !== 'boolean') throw new RangeError('INVALID_BOOLEAN');
  w.u8(value ? 1 : 0);
}
export function readPoint(r: Reader): Point {
  const point = { x: r.i32(), y: r.i32(), z: r.i32() };
  if (Object.values(point).some(n => n < WORLD_MIN_CM || n > WORLD_MAX_CM)) r.fail('OUT_OF_RANGE');
  return point;
}
export function writePoint(w: Writer, point: Point): void {
  for (const n of [point.x, point.y, point.z]) {
    if (!Number.isInteger(n) || n < WORLD_MIN_CM || n > WORLD_MAX_CM) throw new RangeError('INVALID_POINT');
    w.i32(n);
  }
}
