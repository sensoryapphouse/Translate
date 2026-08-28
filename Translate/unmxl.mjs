// UNMXL — compressed MusicXML (.mxl) archive decoder.
//
// .mxl is a ZIP archive containing META-INF/container.xml pointing to the main
// .xml or .musicxml score file. This module unpacks the archive in memory
// using standard Web APIs (DecompressStream) with zero external dependencies.

/**
 * Unpack a ZIP archive ArrayBuffer into a Map of filename -> Uint8Array data.
 */
export async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const files = new Map();
  let pos = 0;

  while (pos + 30 <= bytes.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break; // End of local file headers / Central dir
    const method = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);

    const nameBytes = bytes.subarray(pos + 30, pos + 30 + nameLen);
    const fileName = new TextDecoder().decode(nameBytes);
    const dataStart = pos + 30 + nameLen + extraLen;
    const compData = bytes.subarray(dataStart, dataStart + compSize);

    let decompressed;
    if (method === 0) {
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
        writer.write(compData);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        let totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
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

    files.set(fileName, decompressed);
    pos = dataStart + compSize;
  }
  return files;
}

/**
 * Extract raw MusicXML text string from a .mxl ArrayBuffer.
 *
 * @param {ArrayBuffer} buffer  the raw bytes of the .mxl file
 * @returns {Promise<string>}  the decompressed MusicXML string
 */
export async function mxlToText(buffer) {
  const files = await unzip(buffer);
  if (!files.size) throw new Error('Invalid or empty .mxl zip archive');

  // Look for META-INF/container.xml
  let rootPath = null;
  const containerData = files.get('META-INF/container.xml') || files.get('meta-inf/container.xml');
  if (containerData) {
    const containerXml = new TextDecoder('utf-8').decode(containerData);
    const match = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
    if (match) rootPath = match[1];
  }

  // Fallback: find first .xml or .musicxml file if container.xml is missing or path not found
  if (!rootPath || !files.has(rootPath)) {
    for (const fileName of files.keys()) {
      if (/\.(xml|musicxml)$/i.test(fileName) && !/^META-INF/i.test(fileName)) {
        rootPath = fileName;
        break;
      }
    }
  }

  if (!rootPath || !files.has(rootPath)) {
    throw new Error('No MusicXML root file found in .mxl archive');
  }

  const scoreBytes = files.get(rootPath);
  return new TextDecoder('utf-8').decode(scoreBytes);
}
