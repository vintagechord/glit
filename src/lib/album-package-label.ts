/** Use station count as the pricing unit while preserving diagnostic packages. */
export function getAlbumPackageLabel(name?: string | null, stationCount?: number | null, fallback = "-") {
  if (name?.startsWith("[테스트]")) return name;
  if (typeof stationCount === "number" && Number.isInteger(stationCount) && stationCount > 0) {
    return `방송국 ${stationCount}곳 · 앨범 1건`;
  }
  return name || fallback;
}
