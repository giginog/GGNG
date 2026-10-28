import { deflateRawSync, inflateRawSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}

function u32(buf: Uint8Array, off: number): number {
  return (
    (buf[off]! |
      (buf[off + 1]! << 8) |
      (buf[off + 2]! << 16) |
      (buf[off + 3]! * 0x1000000)) >>>
    0
  );
}

function pushU16(out: number[], n: number): void {
  out.push(n & 0xff, (n >>> 8) & 0xff);
}

function pushU32(out: number[], n: number): void {
  out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

function findEocd(buf: Uint8Array): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const commentLen = u16(buf, i + 20);
      if (i + 22 + commentLen === buf.length) return i;
    }
  }
  throw new Error("ZIP: EOCD introuvable");
}

/** Unpack a ZIP archive into path → bytes. Paths use `/`. */
export function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const eocd = findEocd(buf);
  const count = u16(buf, eocd + 10);
  let offset = u32(buf, eocd + 16);
  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (u32(buf, offset) !== 0x02014b50) throw new Error("ZIP: entrée centrale invalide");
    const method = u16(buf, offset + 10);
    const compressedSize = u32(buf, offset + 20);
    const uncompressedSize = u32(buf, offset + 24);
    const nameLen = u16(buf, offset + 28);
    const extraLen = u16(buf, offset + 30);
    const commentLen = u16(buf, offset + 32);
    const localOff = u32(buf, offset + 42);
    const name = new TextDecoder("utf-8").decode(buf.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (u32(buf, localOff) !== 0x04034b50) throw new Error(`ZIP: en-tête local invalide (${name})`);
    const localNameLen = u16(buf, localOff + 26);
    const localExtraLen = u16(buf, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    let raw: Uint8Array;
    if (method === 0) raw = compressed;
    else if (method === 8) raw = inflateRawSync(compressed);
    else throw new Error(`ZIP: compression ${method} non supportée (${name})`);
    if (raw.length !== uncompressedSize) {
      throw new Error(`ZIP: taille décompressée (${name})`);
    }
    files.set(name.replaceAll("\\", "/"), raw);
  }
  return files;
}

/** Pack path → bytes as a ZIP (deflate). */
export function zip(files: Map<string, Uint8Array>): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  const now = new Date();
  const dosTime =
    (now.getSeconds() >> 1) | (now.getMinutes() << 5) | (now.getHours() << 11);
  const dosDate =
    now.getDate() | ((now.getMonth() + 1) << 5) | ((now.getFullYear() - 1980) << 9);

  const entries = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [name, data] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const method = compressed.length < data.length ? 8 : 0;
    const payload = method === 8 ? compressed : data;
    const localOff = local.length;

    pushU32(local, 0x04034b50);
    pushU16(local, 20);
    pushU16(local, 0x0800);
    pushU16(local, method);
    pushU16(local, dosTime);
    pushU16(local, dosDate);
    pushU32(local, crc);
    pushU32(local, payload.length);
    pushU32(local, data.length);
    pushU16(local, nameBytes.length);
    pushU16(local, 0);
    for (const b of nameBytes) local.push(b);
    for (const b of payload) local.push(b);

    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, 0x0800);
    pushU16(central, method);
    pushU16(central, dosTime);
    pushU16(central, dosDate);
    pushU32(central, crc);
    pushU32(central, payload.length);
    pushU32(central, data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, localOff);
    for (const b of nameBytes) central.push(b);
  }

  const centralOff = local.length;
  const out = new Uint8Array(local.length + central.length + 22);
  out.set(local, 0);
  out.set(central, local.length);
  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0);
  pushU16(eocd, 0);
  pushU16(eocd, entries.length);
  pushU16(eocd, entries.length);
  pushU32(eocd, central.length);
  pushU32(eocd, centralOff);
  pushU16(eocd, 0);
  out.set(eocd, local.length + central.length);
  return out;
}
