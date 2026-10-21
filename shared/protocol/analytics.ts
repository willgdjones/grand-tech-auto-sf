import { cleanAnalyticsContext, type AnalyticsContext } from '../analytics';
import type { Reader, Writer } from './bytes';
import { readString } from './fields';
const MAX = 1536;
export function writeAnalytics(writer: Writer, input: AnalyticsContext | undefined): void {
  const context = cleanAnalyticsContext(input);
  writer.str16(context ? JSON.stringify(context) : '', MAX);
}
export function readAnalytics(reader: Reader): AnalyticsContext | undefined {
  const json = readString(reader, MAX, true);
  if (!json || reader.error) return;
  try {
    const context = cleanAnalyticsContext(JSON.parse(json));
    if (!context) reader.fail('OUT_OF_RANGE');
    return context;
  } catch { reader.fail('OUT_OF_RANGE'); return; }
}
