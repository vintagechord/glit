export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store, max-age=0",
};

export function GET() {
  return new Response("ok", {
    status: 200,
    headers,
  });
}

export function HEAD() {
  return new Response(null, {
    status: 200,
    headers,
  });
}
