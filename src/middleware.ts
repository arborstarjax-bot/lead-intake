// No auth layer: this app is single-user and all mutations are protected by
// going through server routes (service role) rather than by session. The
// middleware is intentionally a no-op; kept as a file so we can reintroduce
// auth later without restructuring routes.

import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
