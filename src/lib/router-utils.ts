export const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteParams = Record<string, string | string[] | undefined>;
type RouteSearchParams = { id?: string } & Record<
  string,
  string | string[] | undefined
>;

export function extractUuidFromRoute(
  params: RouteParams | undefined,
  searchParams?: RouteSearchParams,
): string {
  const candidates: string[] = [];

  if (searchParams?.id && typeof searchParams.id === "string") {
    candidates.push(searchParams.id);
  }

  if (params) {
    for (const value of Object.values(params)) {
      if (typeof value === "string") {
        candidates.push(value);
      }
    }
  }

  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (uuidPattern.test(trimmed)) {
      return trimmed;
    }
  }

  return "";
}
