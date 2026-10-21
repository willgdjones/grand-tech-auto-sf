import { mkdir, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sortByKey } from './sort';

export interface CanonicalJsonOptions {
  pretty?: boolean;
  sortKeys?: boolean;
}

/** Serialize only JSON data, without running getters/toJSON or silently dropping unsupported values. */
export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  const ancestors = new Set<object>();
  const render = (current: unknown, depth: number): string => {
    if (current === null) return 'null';
    if (typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('Canonical JSON numbers must be finite');
      return Object.is(current, -0) ? '0' : current.toString();
    }
    if (typeof current !== 'object')
      throw new TypeError(`Unsupported canonical JSON value: ${typeof current}`);
    if (ancestors.has(current)) throw new TypeError('Canonical JSON cannot contain cycles');
    const array = Array.isArray(current);
    const prototype: unknown = Object.getPrototypeOf(current);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON requires plain objects and arrays');
    }
    const keys = Reflect.ownKeys(current);
    if (keys.some((key) => typeof key !== 'string'))
      throw new TypeError('Canonical JSON cannot contain symbol keys');
    if (array && keys.length !== current.length + 1)
      throw new TypeError('Canonical JSON requires dense arrays without extra properties');
    ancestors.add(current);
    try {
      const members: string[] = [];
      const names = array
        ? Array.from({ length: current.length }, (_, index) => String(index))
        : options.sortKeys
          ? sortByKey(keys as string[], (key) => key)
          : (keys as string[]);
      for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw new TypeError('Canonical JSON requires enumerable data properties');
        }
        const encoded = render(descriptor.value, depth + 1);
        members.push(array ? encoded : `${JSON.stringify(name)}:${options.pretty ? ' ' : ''}${encoded}`);
      }
      const [start, end] = array ? ['[', ']'] : ['{', '}'];
      if (members.length === 0) return `${start}${end}`;
      if (!options.pretty) return `${start}${members.join(',')}${end}`;
      const indent = '  '.repeat(depth + 1);
      return `${start}\n${indent}${members.join(`,\n${indent}`)}\n${'  '.repeat(depth)}${end}`;
    } finally {
      ancestors.delete(current);
    }
  };
  return `${render(value, 0)}\n`;
}

let temporaryCounter = 0;

async function createTemporary(path: string): Promise<{ path: string; handle: FileHandle }> {
  for (;;) {
    const temporary = `${path}.tmp-${process.pid}-${temporaryCounter++}`;
    try {
      return { path: temporary, handle: await open(temporary, 'wx') };
    } catch (error) {
      // A prior run or another worker can own this candidate. Never replace or remove it.
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }
}

/** Publish complete bytes by rename; temporary-file ownership is established with exclusive creation. */
export async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  const content = typeof bytes === 'string' ? bytes : Uint8Array.from(bytes);
  await mkdir(dirname(path), { recursive: true });
  const temporary = await createTemporary(path);
  try {
    await temporary.handle.writeFile(content);
    await temporary.handle.close();
    await rename(temporary.path, path);
  } catch (error) {
    await temporary.handle.close().catch(() => undefined);
    await unlink(temporary.path).catch(() => undefined);
    throw error;
  }
}
