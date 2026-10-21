export const SOURCE_IDS = [
  'terrain-terrarium',
  'datasf-building-footprints',
  'datasf-height-metadata',
  'osm-extract',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
export type Bbox = readonly [number, number, number, number];
export interface HeightSemantics {
  roofField: string;
  roofKind: 'aboveGround' | 'elevation';
  roofUnit: 'ft' | 'us-survey-ft' | 'm';
  groundField: string;
  groundUnit: 'ft' | 'us-survey-ft' | 'm';
  toMetres: number;
  verticalDatum?: string;
  verifiedBy: string;
  evidence: string;
}
export interface Source {
  id: SourceId;
  url: string;
  format: 'geojson' | 'citygml-zip' | 'file-geodatabase-zip' | 'osm-json';
  crs: string;
  crsNote?: string;
  downloadedAt: string;
  bytes: number;
  sha256: string;
  licence: string;
  attribution: string;
  heightSemantics?: HeightSemantics;
  extractDate?: string;
  osmExportBbox?: Bbox;
  query?: string;
}
export interface SourceLock {
  version: 1;
  sources: Source[];
}
const HASH = /^[a-f0-9]{64}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('SOURCE_LOCK_INVALID(object)');
  return value as Record<string, unknown>;
}
function text(row: Record<string, unknown>, key: string, empty = false): string {
  const value = row[key];
  if (typeof value !== 'string' || (!empty && !value.trim())) throw new Error(`SOURCE_LOCK_INVALID(${key})`);
  return value;
}
function keys(row: Record<string, unknown>, allowed: string): void {
  const names = new Set(allowed.split(' '));
  if (Object.keys(row).some((key) => !names.has(key))) throw new Error('SOURCE_LOCK_INVALID(unknown field)');
}
export function parseLock(bytes: Uint8Array | string): SourceLock {
  let value: unknown;
  try {
    value = JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('SOURCE_LOCK_INVALID(json)');
  }
  const row = record(value);
  keys(row, 'version sources');
  if (row.version !== 1 || !Array.isArray(row.sources) || row.sources.length !== SOURCE_IDS.length)
    throw new Error('SOURCE_LOCK_INVALID(version/sources)');
  const sources = row.sources.map((value: unknown, index): Source => {
    const source = record(value);
    keys(
      source,
      'id url format crs crsNote downloadedAt bytes sha256 licence attribution heightSemantics extractDate osmExportBbox query',
    );
    const id = SOURCE_IDS[index]!;
    if (source.id !== id) throw new Error('SOURCE_LOCK_INVALID(ids/order)');
    const url = text(source, 'url');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`SOURCE_LOCK_INVALID(url:${id})`);
    }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash)
      throw new Error(`SOURCE_LOCK_INVALID(url:${id})`);
    // Plain HTTP exists for local fixtures only; actual pins are HTTPS, checked in provenance tests.
    if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
      throw new Error(`SOURCE_LOCK_INVALID(https:${id})`);
    const format = source.format;
    if (
      format !== 'geojson' &&
      format !== 'citygml-zip' &&
      format !== 'file-geodatabase-zip' &&
      format !== 'osm-json'
    )
      throw new Error(`SOURCE_LOCK_INVALID(format:${id})`);
    const sha256 = text(source, 'sha256');
    if (
      !HASH.test(sha256) ||
      typeof source.bytes !== 'number' ||
      !Number.isSafeInteger(source.bytes) ||
      source.bytes <= 0
    )
      throw new Error(`SOURCE_LOCK_INVALID(pin:${id})`);
    const downloadedAt = text(source, 'downloadedAt');
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(downloadedAt) ||
      !Number.isFinite(Date.parse(downloadedAt))
    )
      throw new Error(`SOURCE_LOCK_INVALID(date:${id})`);
    const result: Source = {
      id,
      url,
      format,
      crs: text(source, 'crs'),
      downloadedAt,
      bytes: source.bytes,
      sha256,
      licence: text(source, 'licence'),
      attribution: text(source, 'attribution'),
      ...(source.crsNote === undefined ? {} : { crsNote: text(source, 'crsNote') }),
    };
    if (source.heightSemantics !== undefined) {
      const height = record(source.heightSemantics);
      keys(
        height,
        'roofField roofKind roofUnit groundField groundUnit toMetres verticalDatum verifiedBy evidence',
      );
      if (height.roofKind !== 'aboveGround' && height.roofKind !== 'elevation')
        throw new Error('SOURCE_LOCK_INVALID(roofKind)');
      const unit = (value: unknown): HeightSemantics['roofUnit'] => {
        if (value !== 'ft' && value !== 'us-survey-ft' && value !== 'm')
          throw new Error('SOURCE_LOCK_INVALID(unit)');
        return value;
      };
      const roofUnit = unit(height.roofUnit);
      const groundUnit = unit(height.groundUnit);
      const factor = roofUnit === 'm' ? 1 : roofUnit === 'ft' ? 0.3048 : 1200 / 3937;
      if (height.toMetres !== factor || groundUnit !== roofUnit)
        throw new Error('SOURCE_LOCK_INVALID(toMetres)');
      result.heightSemantics = {
        roofField: text(height, 'roofField'),
        roofKind: height.roofKind,
        roofUnit,
        groundField: text(height, 'groundField'),
        groundUnit,
        toMetres: factor,
        verifiedBy: text(height, 'verifiedBy', true),
        evidence: text(height, 'evidence'),
        ...(height.verticalDatum === undefined ? {} : { verticalDatum: text(height, 'verticalDatum') }),
      };
    }
    if ((id === 'datasf-building-footprints' || id === 'terrain-terrarium') && !result.heightSemantics)
      throw new Error(`SOURCE_LOCK_INVALID(height:${id})`);
    if (
      id === 'terrain-terrarium' &&
      (!result.heightSemantics?.verticalDatum || result.heightSemantics.roofKind !== 'elevation')
    )
      throw new Error('SOURCE_LOCK_INVALID(3d vertical datum)');
    if (id === 'osm-extract') {
      const bbox = source.osmExportBbox;
      if (
        !Array.isArray(bbox) ||
        bbox.length !== 4 ||
        bbox.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n)) ||
        !(
          bbox[0] < bbox[2] &&
          bbox[1] < bbox[3] &&
          bbox[0] >= -180 &&
          bbox[2] <= 180 &&
          bbox[1] >= -90 &&
          bbox[3] <= 90
        )
      )
        throw new Error('SOURCE_LOCK_INVALID(osmExportBbox)');
      result.osmExportBbox = bbox as unknown as Bbox;
      result.extractDate = text(source, 'extractDate');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(result.extractDate) || !Number.isFinite(Date.parse(result.extractDate)))
        throw new Error('SOURCE_LOCK_INVALID(extractDate)');
      if (format !== 'osm-json') throw new Error('SOURCE_LOCK_INVALID(osm format)');
      if (source.query !== undefined) {
        result.query = text(source, 'query');
        if (parsed.searchParams.get('data') !== result.query)
          throw new Error('SOURCE_LOCK_INVALID(query/url)');
      }
    }
    return result;
  });
  return { version: 1, sources };
}
export function extension(source: Source): string {
  return source.format.endsWith('-zip') ? 'zip' : source.format === 'geojson' ? 'geojson' : 'json';
}
