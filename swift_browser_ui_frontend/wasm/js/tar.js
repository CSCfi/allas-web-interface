// Tar convenience functions

const enc = new TextEncoder();

/** UTF-8 byte length of a JS string */
function byteLen(s) {
  return enc.encode(s).length;
}

/**
 * Encode JS string to a "binary string" where each charCode is a single byte 0..255.
 * Safe input for convertToArray() and calcChecksum().
 */
function utf8BinaryString(s) {
  const bytes = enc.encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Encode a JS string to exactly N bytes (UTF-8), truncating by BYTES, then pad with NULs */
function utf8ToFixedBytesBinaryString(s, n) {
  const bytes = enc.encode(s);
  const slice = bytes.length > n ? bytes.slice(0, n) : bytes;
  let out = "";
  for (let i = 0; i < slice.length; i++) out += String.fromCharCode(slice[i]);
  if (slice.length < n) out += "\x00".repeat(n - slice.length);
  return out;
}

/** Convert a "binary string" (each charCode is a byte) to Uint8Array */
function convertToArray(binaryStr) {
  const ret = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    ret[i] = binaryStr.charCodeAt(i) & 0xff;
  }
  return ret;
}

/** TAR checksum: sum of all bytes in the 512-byte header */
function calcChecksum(header512BinaryStr) {
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header512BinaryStr.charCodeAt(i) & 0xff;
  // 6 digits octal, NUL, space => total 8 bytes
  return checksum.toString(8).padStart(6, "0") + "\x00 ";
}

// Common header tail (after typeflag). POSIX ustar.
const headerEnd =
  "\x00".repeat(100) + // linkname[100]
  "ustar\x00" +        // magic[6] = "ustar\0"
  "00" +               // version[2] = "00"
  "\x00".repeat(32) +  // uname[32]
  "\x00".repeat(32) +  // gname[32]
  "0000000\x00" +      // devmajor[8]
  "0000000\x00" +      // devminor[8]
  "\x00".repeat(155) + // prefix[155]
  "\x00".repeat(12);   // pad[12] to reach 512 bytes total


function octal11(n) {
  return n.toString(8).padStart(11, "0") + "\x00";
}

function mtimeOctal() {
  return Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\x00";
}

/**
 * Build a GNU LongLink block (+ data block) for a UTF-8 path.
 * Returns a binary string with length multiple of 512.
 */
function buildLongLinkBlocks(path) {
  // LongLink data is the full pathname in bytes + trailing NUL
  const pathDataBinary = utf8BinaryString(path) + "\x00";
  const pathBytesWithNul = byteLen(path) + 1;

  // Pad data to 512 boundary (BYTES)
  let pathBlock = pathDataBinary;
  const rem = pathBytesWithNul % 512;
  if (rem !== 0) pathBlock += "\x00".repeat(512 - rem);

  // LongLink header: name "././@LongLink" and typeflag 'L'
  let lHeader =
    utf8ToFixedBytesBinaryString("././@LongLink", 100) +
    "0000644\x00" +
    "0000000\x00" +
    "0000000\x00" +
    octal11(pathBytesWithNul) +
    "00000000000\x00" + // mtime not used here
    "        " +         // checksum placeholder (8 spaces)
    "L" +                // typeflag
    headerEnd;

  // Fill checksum
  lHeader = lHeader.replace("        ", calcChecksum(lHeader));

  return lHeader + pathBlock;
}

/**
 * Build a regular TAR header (one 512-byte block).
 * name100Binary must be exactly 100 bytes (binary string).
 */
function buildHeader({ name100Binary, mode, uid, gid, sizeField, mtimeField, typeflag }) {
  let header =
    name100Binary +
    mode +
    uid +
    gid +
    sizeField +
    mtimeField +
    "        " + // checksum placeholder
    typeflag +
    headerEnd;

  header = header.replace("        ", calcChecksum(header));
  return header;
}

// Add a folder to the tar archive structure
export function addTarFolder(path) {
  const mtime = mtimeOctal();
  let out = "";

  // TAR directory entries should end with '/'
  const dirPath = path.endsWith("/") ? path : path + "/";

  if (byteLen(dirPath) > 100) {
    out += buildLongLinkBlocks(dirPath);

    // Name field is 100 BYTES, so truncate by bytes
    const name100 = utf8ToFixedBytesBinaryString(dirPath, 100);

    out += buildHeader({
      name100Binary: name100,
      mode: "0000755\x00",
      uid: "0000000\x00",
      gid: "0000000\x00",
      sizeField: "00000000000\x00",
      mtimeField: mtime,
      typeflag: "5",
    });
  } else {
    const name100 = utf8ToFixedBytesBinaryString(dirPath, 100);
    out += buildHeader({
      name100Binary: name100,
      mode: "0000755\x00",
      uid: "0000000\x00",
      gid: "0000000\x00",
      sizeField: "00000000000\x00",
      mtimeField: mtime,
      typeflag: "5",
    });
  }

  return convertToArray(out);
}

// Add a file to the tar archive structure
export function addTarFile(path, size) {
  const mtime = mtimeOctal();
  let out = "";

  // Size field: octal up to < 8 GiB, else base-256 (12 bytes)
  const maxOctal = 8589934592; // 8 GiB
  let sizeField = "";

  if (size < maxOctal) {
    sizeField = octal11(size);
  } else {
    // base-256 (signed) 12 bytes
    let bytes = BigInt(size);
    const base256 = [];
    do {
      base256.unshift(Number(bytes % 256n));
      bytes = bytes / 256n;
    } while (bytes);

    while (base256.length < 12) base256.unshift(0);
    base256[0] |= 0x80; // set base-256 indicator
    sizeField = base256.map((b) => String.fromCharCode(b)).join("");
  }

  if (byteLen(path) > 100) {
    out += buildLongLinkBlocks(path);

    const name100 = utf8ToFixedBytesBinaryString(path, 100);

    out += buildHeader({
      name100Binary: name100,
      mode: "0000644\x00",
      uid: "0000000\x00",
      gid: "0000000\x00",
      sizeField,
      mtimeField: mtime,
      typeflag: "0",
    });
  } else {
    const name100 = utf8ToFixedBytesBinaryString(path, 100);
    out += buildHeader({
      name100Binary: name100,
      mode: "0000644\x00",
      uid: "0000000\x00",
      gid: "0000000\x00",
      sizeField,
      mtimeField: mtime,
      typeflag: "0",
    });
  }

  return convertToArray(out);
}
