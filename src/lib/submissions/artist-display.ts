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

/**
 * The 한글/영문 names kept for reference next to the official credit: the
 * MV form's 아티스트명 (한글/영문), or the album form's 한글명 and 영문명.
 */
export function artistReferenceNames(row: ArtistNameRow & { artist_name_en?: string | null }): string[] {
  const official = officialArtistName(row);
  const candidates = row.type?.startsWith("MV_")
    ? [row.artist_name]
    : [row.artist_name_kr, row.artist_name_en];
  const names = candidates.map((name) => name?.trim() ?? "").filter((name) => name && name !== official);
  return [...new Set(names)];
}
