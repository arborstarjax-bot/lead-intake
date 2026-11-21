import { NextRequest, NextResponse } from "next/server";

/**
 * Response envelope + pagination helpers shared by every /api/v1 route.
 *
 *   Single:  { data: {...} }
 *   List:    { data: [...], meta: { next_cursor, has_more } }
 *   Error:   { error: { code, message } }
 */
export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json(meta ? { data, meta } : { data }, { status });
}

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Adapt a shared-module handler result ({ status, body } with flat
 * `{ error: "…" }` failures) into the v1 envelope. Success bodies pass
 * through under `data`; failures become `{ error: { code, message } }`
 * with any extra fields (connectUrl, code) preserved at top level.
 */
export function handlerResult(res: { status: number; body: Record<string, unknown> }) {
  if (res.status < 400) return ok(res.body, undefined, res.status);
  const { error, ...rest } = res.body;
  const code = typeof rest.code === "string" ? rest.code : "error";
  return NextResponse.json(
    { error: { code, message: String(error ?? "Request failed") }, ...rest },
    { status: res.status }
  );
}

export const badRequest = (message: string) => apiError(400, "bad_request", message);
export const notFound = (what = "resource") => apiError(404, "not_found", `${what} not found`);
export const serverError = (message = "Internal error") => apiError(500, "internal", message);

/**
 * Cursor pagination: cursor is a base64url of the row's `created_at|id`
 * so ordering is stable across concurrent inserts.
 */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString("base64url");
}
export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, "base64url").toString().split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export type ListParams = {
  limit: number;      // 1..100, default 50
  cursor: { createdAt: string; id: string } | null;
  updatedSince: string | null; // ISO timestamptz filter
  status: string | null;
};

export function listParams(req: NextRequest): ListParams {
  const sp = req.nextUrl.searchParams;
  const rawLimit = parseInt(sp.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const rawCursor = sp.get("cursor");
  const updated = sp.get("updated_since");
  return {
    limit,
    cursor: rawCursor ? decodeCursor(rawCursor) : null,
    updatedSince: updated && !Number.isNaN(Date.parse(updated)) ? updated : null,
    status: sp.get("status"),
  };
}

export function pageMeta<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number
): { next_cursor: string | null; has_more: boolean } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    has_more: hasMore,
  };
}

/** snake_case → camelCase, deep, for contract responses. */
export function toCamel<T>(value: T): T {
  if (Array.isArray(value)) return value.map(toCamel) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = toCamel(v);
    }
    return out as T;
  }
  return value;
}
