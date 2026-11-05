// The Word 97–2003 (.doc) form reader lives with the review desk so the desk
// and the web admin read reference forms the same way (tables kept).
import {
  LegacyWordError as DeskLegacyWordError,
  legacyWordBlocksToDocx as deskBlocksToDocx,
  readLegacyWordBlocks as deskReadBlocks,
} from "../../../tools/onside-desk/manual-doc.mjs";

export type LegacyWordBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "row"; cells: string[] };

export const LegacyWordError = DeskLegacyWordError as unknown as new (code: string, message: string) => Error & { code: string };

export function readLegacyWordBlocks(body: Buffer): LegacyWordBlock[] {
  return deskReadBlocks(body) as LegacyWordBlock[];
}

export function legacyWordBlocksToDocx(blocks: LegacyWordBlock[]): Buffer {
  return deskBlocksToDocx(blocks) as Buffer;
}
