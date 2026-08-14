import { handleInicisReturn } from "../../return/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handleInicisReturn;
export const GET = () =>
  new Response(null, {
    status: 405,
    headers: { Allow: "POST" },
  });
