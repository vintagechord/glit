/**
 * Generates a UUID with graceful fallback for browsers that lack crypto.randomUUID (older iOS Safari).
 */
export const safeRandomUUID = () => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Version 4 UUID variant bits
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const toHex = (n: number) => n.toString(16).padStart(2, "0");
      return (
        toHex(bytes[0]) +
        toHex(bytes[1]) +
        toHex(bytes[2]) +
        toHex(bytes[3]) +
        "-" +
        toHex(bytes[4]) +
        toHex(bytes[5]) +
        "-" +
        toHex(bytes[6]) +
        toHex(bytes[7]) +
        "-" +
        toHex(bytes[8]) +
        toHex(bytes[9]) +
        "-" +
        toHex(bytes[10]) +
        toHex(bytes[11]) +
        toHex(bytes[12]) +
        toHex(bytes[13]) +
        toHex(bytes[14]) +
        toHex(bytes[15])
      );
    }
  } catch {
    // ignore and fall through to timestamp fallback
  }
  return `uuid-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};
