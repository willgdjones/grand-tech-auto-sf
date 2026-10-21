/** Uploaded files stay private until the existing ad normalizer + human review approve them. */
export function inspectLogo(bytes: Uint8Array): { width: number; height: number; mime: string } {
  if (bytes.length < 24 || bytes.length > 2_000_000) throw new Error('LOGO_SIZE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, size: number) => String.fromCharCode(...bytes.subarray(offset, offset + size));
  let width = 0, height = 0, mime = '';
  if (bytes[0] === 137 && text(1, 7) === 'PNG\r\n\u001a\n') {
    if (view.getUint32(8) !== 13 || text(12, 4) !== 'IHDR') throw new Error('INVALID_LOGO');
    width = view.getUint32(16); height = view.getUint32(20); mime = 'image/png';
    let end = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), kind = text(offset + 4, 4);
      if (length > bytes.length - offset - 12 || kind === 'acTL') throw new Error('INVALID_LOGO');
      offset += length + 12;
      if (kind === 'IEND') { end = offset === bytes.length; break; }
    }
    if (!end) throw new Error('INVALID_LOGO');
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg';
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 255) throw new Error('INVALID_LOGO');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) throw new Error('INVALID_LOGO');
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('INVALID_LOGO');
      if ([192,193,194].includes(marker)) {
        if (length < 8 || width) throw new Error('INVALID_LOGO');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      offset += length;
    }
    if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('INVALID_LOGO');
  } else if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP' && view.getUint32(4, true) === bytes.length - 8) {
    mime = 'image/webp'; const kind = text(12, 4);
    if (kind === 'VP8X' && bytes.length >= 30) {
      if (bytes[20]! & 2) throw new Error('ANIMATED_LOGO');
      width = 1 + bytes[24]! + bytes[25]! * 256 + bytes[26]! * 65_536;
      height = 1 + bytes[27]! + bytes[28]! * 256 + bytes[29]! * 65_536;
    } else if (kind === 'VP8 ' && bytes.length >= 30 && text(23, 3) === '\u009d\u0001*') {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 47) {
      const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  if (!mime || !width || !height || width * height > 1_000_000) throw new Error('LOGO_PIXEL_CAP');
  return { width, height, mime };
}
