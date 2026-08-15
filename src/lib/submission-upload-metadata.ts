export type SubmissionUploadMetadata = {
  path: string;
  originalName: string;
  size: number;
  mime?: string;
};

const normalizeSourcePart = (value: string | undefined) =>
  (value ?? "").trim().toLocaleLowerCase("ko-KR");

export const getSubmissionUploadSourceKey = (
  file: Pick<SubmissionUploadMetadata, "originalName" | "size" | "mime">,
) =>
  [
    normalizeSourcePart(file.originalName),
    Number.isFinite(file.size) ? Math.max(0, file.size) : 0,
    normalizeSourcePart(file.mime),
  ].join("\u0000");

/**
 * Keeps persisted upload metadata unless an incoming item represents the same
 * exact object path. Filename and byte size are intentionally not identities:
 * two different videos can legitimately share both, and preserving a possible
 * duplicate is safer than dropping user data.
 */
export const mergeSubmissionUploadMetadata = <
  T extends SubmissionUploadMetadata,
>(existing: T[], incoming: T[]): T[] => {
  const merged = existing.map((file) => ({ ...file }));

  for (const file of incoming) {
    const path = file.path.trim();
    const existingIndex = merged.findIndex((candidate) => {
      const candidatePath = candidate.path.trim();
      return path.length > 0 && candidatePath === path;
    });

    if (existingIndex >= 0) {
      merged[existingIndex] = { ...file };
    } else {
      merged.push({ ...file });
    }
  }

  return merged;
};

const getMetadataIdentity = (file: SubmissionUploadMetadata) =>
  [
    file.path.trim(),
    getSubmissionUploadSourceKey(file),
  ].join("\u0001");

export const areSubmissionUploadMetadataEqual = (
  left: SubmissionUploadMetadata[],
  right: SubmissionUploadMetadata[],
) => {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(getMetadataIdentity).sort();
  const rightKeys = right.map(getMetadataIdentity).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
};
