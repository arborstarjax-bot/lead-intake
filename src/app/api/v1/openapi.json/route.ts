import { NextRequest, NextResponse } from "next/server";
import { API_DOCS } from "@/modules/api/v1/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/openapi.json — OpenAPI 3.1 spec generated from the same
 * API_DOCS registry that renders /api-docs, so it can't drift. Public:
 * it documents the API, no workspace data is exposed. Importable into
 * Postman, Insomnia, Zapier CLI, etc.
 */
export async function GET(_req: NextRequest) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const group of API_DOCS) {
    for (const ep of group.endpoints) {
      const op: Record<string, unknown> = {
        summary: ep.summary,
        tags: [group.name],
        security: [{ bearerAuth: [] }],
        "x-required-scope": ep.scope,
      };
      const params = ep.params ?? [];
      const query = params
        .filter((p) => p.in === "query" || p.in === "path")
        .map((p) => ({
          name: p.name,
          in: p.in,
          required: p.required ?? p.in === "path",
          schema: { type: p.type === "integer" ? "integer" : "string" },
          description: p.description,
        }));
      if (query.length) op.parameters = query;
      const bodyParams = params.filter((p) => p.in === "body");
      if (bodyParams.length || ep.requestExample) {
        op.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: Object.fromEntries(
                  bodyParams.map((p) => [p.name, { type: "string", description: p.description }])
                ),
              },
            },
          },
        };
      }
      op.responses = {
        "200": { description: "OK — `{ data: … }` envelope" },
        "400": { description: "Bad request" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Missing scope" },
        "404": { description: "Not found" },
      };
      paths[ep.path.replace(/^\//, "/").replace(/{id}|{userId}/, (m) => m)] ??= {};
      paths[ep.path][ep.method.toLowerCase()] = op;
    }
  }

  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "LeadFlow API",
      version: "1.0.0",
      description:
        "Lead intake + day-of-estimates routing for field-service businesses. " +
        "All responses use a `{ data }` envelope; lists add `{ meta: { next_cursor, has_more } }`. " +
        "Authenticate with `Authorization: Bearer lf_live_…` (create keys in Settings → API & Webhooks).",
    },
    servers: [{ url: "https://lead-intake-sooty.vercel.app" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "lf_live_…" },
      },
    },
  });
}
