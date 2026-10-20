// The renewal campaign has ended. Retain this API for existing callers while
// avoiding a settings query on every quote/save. Paid records are not repriced.
export async function getAlbumReviewDiscountPercent(db: unknown) {
  void db;
  return 0;
}
