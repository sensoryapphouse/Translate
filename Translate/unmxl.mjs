// UNZIP — the ZIP reader, in memory, with no dependencies.
//
// It was written to open .mxl (compressed MusicXML) and is still named for
// that. Translate uses it for eBraille, which is also a ZIP; BrlDuet keeps its
// own copy and still reads music with it. The .mxl half - mxlToText, which
// finds the score inside the container - was removed from Translate's copy on
// 2026-09-02 when music left the app (PB). BrlDuet's copy is unchanged.

// THE LIMITS. A ZIP can lie about its sizes and a deflate stream can expand a
// thousandfold (200 MB of zeros deflates to 204 KB), so a .docx, .xlsx or
// crafted .ebrl of a few megabytes could take the whole tab down - and the
// app has no autosave (Translate audit, 2026-09-02). Every document these apps
// read is text: a whole braille book is well under a megabyte, so the caps
// are generous for real files and hopeless for a bomb. They are checked inside
// the read loop, chunk by chunk, never from the sizes the header claims.
export const ZIP_LIMITS = Object.freeze({
  maxTotal: 64 * 1024 * 1024,   // bytes inflated across the whole archive
  maxEntry: 32 * 1024 * 1024,   // bytes inflated for one entry
  maxEntries: 4096,             // local file headers read
  maxRatio: 200,                // inflated:compressed, applied once an entry passes ratioFloor
  ratioFloor: 1024 * 1024,      // below this many inflated bytes the ratio is not judged
});

export class ZipLimitError extends Error {
  constructor(message, entry) { super(message); this.name = 'ZipLimitError'; this.entry = entry; }
}

/**
 * Unpack a ZIP archive ArrayBuffer into a Map of filename -> Uint8Array data.
 * `limits` overrides ZIP_LIMITS (tests use small ones); a breach throws a
 * ZipLimitError naming the entry, and nothing partial is returned.
 */
export async function unzip(buffer, limits = {}) {
  const L = { ...ZIP_LIMITS, ...limits };
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const files = new Map();
  let pos = 0;
  let total = 0;
  const mb = (n) => `${Math.round(n / 1048576)} MB`;
  const refuse = (name, why) => { throw new ZipLimitError(`This file will not open: ${why} (entry "${name}").`, name); };

  while (pos + 30 <= bytes.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break; // End of local file headers / Central dir
    if (files.size >= L.maxEntries) refuse('', `it holds more than ${L.maxEntries} entries`);
    const method = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);

    const nameBytes = bytes.subarray(pos + 30, pos + 30 + nameLen);
    const fileName = new TextDecoder().decode(nameBytes);
    const dataStart = pos + 30 + nameLen + extraLen;
    const compData = bytes.subarray(dataStart, dataStart + compSize);
    // grown so far, this entry included: checked as each chunk arrives
    const grow = (n) => {
      if (n > L.maxEntry) refuse(fileName, `one part of it is larger than ${mb(L.maxEntry)}`);
      if (total + n > L.maxTotal) refuse(fileName, `unpacked it is larger than ${mb(L.maxTotal)}`);
      if (n > L.ratioFloor && n > compData.length * L.maxRatio) refuse(fileName, `it expands more than ${L.maxRatio} times when unpacked`);
    };

    let decompressed;
    if (method === 0) {
      grow(compData.length);
      decompressed = compData;
    } else if (method === 8) {
      // The API is DecompressionStream (Node 18+, all evergreen browsers).
      // The draft named it "DecompressStream", which exists NOWHERE — the
      // typeof guard was false in every environment, so every deflated .mxl
      // (method 8, which is what real producers write) threw, and the test
      // never noticed because it only built a STORED entry (#324). The test
      // now round-trips a genuinely deflated archive.
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        // the writer's promises settle late; when the reader is cancelled below
        // they reject, and an unhandled rejection would end a Node process
        writer.write(compData).catch(() => {});
        writer.close().catch(() => {});
        const reader = ds.readable.getReader();
        const chunks = [];
        let totalLen = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalLen += value.length;
          try { grow(totalLen); } catch (e) { reader.cancel().catch(() => {}); throw e; }
          chunks.push(value);
        }
        decompressed = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          decompressed.set(chunk, offset);
          offset += chunk.length;
        }
      } else {
        throw new Error('DecompressionStream unavailable in this environment.');
      }
    } else {
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }

    total += decompressed.length;
    files.set(fileName, decompressed);
    pos = dataStart + compSize;
  }
  return files;
}
