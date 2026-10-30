import type { NextRequest } from "next/server";

import { handleInicisMobileReturn } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// INIpayMobile delivers the authentication result by POST or GET. The route
// signature must stay (request) only; dependency injection is test-only.
export const POST = (request: NextRequest) => handleInicisMobileReturn(request);
export const GET = (request: NextRequest) => handleInicisMobileReturn(request);
