import {
  buildRuntimeHealthHeadResponse,
  buildRuntimeHealthResponse,
} from "@/lib/runtime-health-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return buildRuntimeHealthResponse();
}

export function HEAD() {
  return buildRuntimeHealthHeadResponse();
}
