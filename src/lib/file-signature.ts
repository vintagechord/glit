export type FileSignatureStatus = "matched" | "mismatch" | "unsupported";

/** Container/header checks only. This does not validate codecs, archives,
 * document structure, duration, or the broadcaster's submission specification. */
export function inspectFileSignature(filename: string, bytes: Uint8Array): FileSignatureStatus {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, count: number) => String.fromCharCode(...bytes.subarray(start, start + count));
  const ole = starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  const zip = starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06);
  let matches: boolean;
  switch (extension) {
    case "wav": matches = ["RIFF", "RIFX", "RF64", "BW64"].includes(ascii(0, 4)) && ascii(8, 4) === "WAVE"; break;
    case "mp3": matches = ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0); break;
    case "doc": matches = ole || /^\s*\{\\rtf[0-9]/.test(ascii(0, 40)); break;
    case "hwp": matches = ole; break;
    case "zip": case "docx": matches = zip; break;
    case "pdf": matches = ascii(0, 1024).includes("%PDF-"); break;
    case "mp4": case "mov": case "m4v": matches = ["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(ascii(4, 4)); break;
    case "wmv": matches = starts(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11); break;
    case "mxf": matches = starts(0x06, 0x0e, 0x2b, 0x34); break;
    case "mpg": case "mpeg": matches = starts(0, 0, 1, 0xba) || starts(0, 0, 1, 0xb3); break;
    case "jpg": case "jpeg": matches = starts(0xff, 0xd8, 0xff); break;
    case "png": matches = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a); break;
    case "webp": matches = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP"; break;
    case "txt": case "lrc":
      // UTF-16 with a byte-order mark is legitimate text despite zero bytes.
      matches = bytes.length > 0 && (!bytes.includes(0) || starts(0xff, 0xfe) || starts(0xfe, 0xff)); break;
    default: return "unsupported";
  }
  return matches ? "matched" : "mismatch";
}
