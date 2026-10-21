/** Compare UTF-8 bytes, including supplementary characters, without depending on host locale. */
export function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Return a sorted copy, evaluating each key once and retaining input order for byte-equal keys. */
export function sortByKey<T>(items: readonly T[], keyFn: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, key: keyFn(item) }))
    .sort((a, b) => byteCompare(a.key, b.key) || a.index - b.index)
    .map(({ item }) => item);
}
