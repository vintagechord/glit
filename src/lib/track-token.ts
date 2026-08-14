const MIN_TRACK_TOKEN_LENGTH = 8;
const MAX_TRACK_TOKEN_LENGTH = 120;

export const decodeTrackToken = (value: string | null | undefined) => {
  if (!value) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  if (
    decoded.length < MIN_TRACK_TOKEN_LENGTH ||
    decoded.length > MAX_TRACK_TOKEN_LENGTH
  ) {
    return null;
  }
  return decoded;
};
