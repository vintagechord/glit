type ArtistNameRow = {
  type?: string | null;
  artist_name?: string | null;
  artist_name_kr?: string | null;
};

/**
 * The artist name staff should read for a submission: its 아티스트명 공식 표기.
 * The album form files the official credit in artist_name. The MV form files
 * 아티스트명 (한글/영문) in artist_name and the official credit in
 * artist_name_kr; MV requests from before that field existed have no
 * artist_name_kr and fall back to artist_name.
 */
export function officialArtistName(row: ArtistNameRow): string | null {
  const official = row.type?.startsWith("MV_") ? row.artist_name_kr?.trim() : "";
  return official || row.artist_name?.trim() || null;
}
