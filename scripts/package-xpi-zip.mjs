import zlib from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipBuffer(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data, { level: 9 });

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x0021, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBuf.copy(lh, 30);

    localHeaders.push(lh, compressed);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x0021, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);

    centralHeaders.push(cd);
    offset += lh.length + compressed.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of centralHeaders) cdSize += cd.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export function readZipEntries(zipBuffer, requireCondition) {
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  requireCondition(eocdOffset >= 0, 'Corrupt XPI: End of Central Directory not found');

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let currentOffset = cdOffset;
  const entries = new Map();

  for (let i = 0; i < totalEntries; i++) {
    const sig = zipBuffer.readUInt32LE(currentOffset);
    requireCondition(sig === 0x02014b50, 'Corrupt XPI: Invalid Central Directory signature');

    const method = zipBuffer.readUInt16LE(currentOffset + 10);
    const expectedCrc = zipBuffer.readUInt32LE(currentOffset + 16);
    const compSize = zipBuffer.readUInt32LE(currentOffset + 20);
    const uncompSize = zipBuffer.readUInt32LE(currentOffset + 24);
    const nameLen = zipBuffer.readUInt16LE(currentOffset + 28);
    const extraLen = zipBuffer.readUInt16LE(currentOffset + 30);
    const commentLen = zipBuffer.readUInt16LE(currentOffset + 32);
    const localOffset = zipBuffer.readUInt32LE(currentOffset + 42);

    const name = zipBuffer.toString('utf8', currentOffset + 46, currentOffset + 46 + nameLen);
    currentOffset += 46 + nameLen + extraLen + commentLen;

    const lhSig = zipBuffer.readUInt32LE(localOffset);
    requireCondition(lhSig === 0x04034b50, `Corrupt XPI: Invalid Local Header signature for ${name}`);
    const lhNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const lhExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const rawData = zipBuffer.subarray(dataStart, dataStart + compSize);

    let decompressed;
    if (method === 0) {
      decompressed = rawData;
    } else if (method === 8) {
      decompressed = zlib.inflateRawSync(rawData);
    } else {
      throw new Error(`Unsupported compression method ${method} in XPI`);
    }

    requireCondition(decompressed.length === uncompSize, `Size mismatch for ${name}`);
    requireCondition(crc32(decompressed) === expectedCrc, `CRC mismatch for ${name}`);
    entries.set(name, decompressed);
  }

  return entries;
}
