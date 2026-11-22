# LeadFlow REST API (v1)

Public REST API for CRM integrations (Jobber, ServiceTitan, Housecall Pro, HubSpot, Zapier/Make, custom). In-app reference: **`/api-docs`** inside the app (auth required).

## Auth

Two ways — both resolve to a workspace:

- **API key** (integrations): `Authorization: Bearer lf_live_…` — create in Settings → API & Webhooks. Keys carry scopes (`leads:read`, `leads:write`, `tasks:read`, `tasks:write`, `workspace:read`, `settings:read`, `reports:read`, `webhooks:manage`); plaintext is shown once.
- **Session cookie** (the web app itself, e.g. the docs page).

## Conventions

- Base: `https://<host>/api/v1`
- Success: `{ data }` (lists add `meta.next_cursor`, `meta.has_more`). Error: `{ error: { code, message } }`.
- List params: `limit` (1–100, default 50), `cursor`, `updated_since` (ISO 8601 — use for CRM sync), `status`.
- Field names are camelCase; vocabulary is generic field-service (`contact`, `estimate`, `assignee`).

## Endpoints

| Group | Endpoints |
|-------|-----------|
| Leads | `GET/POST /leads`, `GET/PATCH/DELETE /leads/{id}`, `GET/POST /leads/{id}/activities` |
| Tasks | `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/{id}` |
| Schedule | `GET /schedule/day?date=`, `POST /schedule/preview`, `POST /schedule/suggest`, `POST /schedule/book`, `POST /schedule/reorder`, `POST /schedule/sync` |
| Workspace | `GET /workspace`, `GET /members`, `PATCH/DELETE /members/{userId}` |
| Config | `GET/PATCH /settings`, `GET /reports/summary?days=30` |
| Webhooks | `GET/POST /webhooks`, `PATCH/DELETE /webhooks/{id}`, `GET /webhooks/{id}/deliveries` |
| Ingest | `POST /ingest` (lead text or base64 screenshots → extraction pipeline) |
| Spec | `GET /openapi.json` (OpenAPI 3.1, generated from the docs registry) |
| Key management | `GET/POST /keys`, `DELETE /keys/{id}` (admin session only) |

Lead shape:

```json
{
  "id": "uuid",
  "contact": { "firstName": "…", "lastName": "…", "name": "…", "phone": "…", "email": "…",
               "address": { "line1": "…", "city": "…", "state": "…", "zip": "…" } },
  "source": "Thumbtack", "type": "Residential", "jobType": "Repair",
  "status": "New|Scheduled|Pending|Completed|Lost|Called / No Response",
  "assignee": "David",
  "estimate": { "scheduledDay": "2026-11-23", "scheduledTime": "08:00",
                "flexWindow": "am", "outcome": "Sold", "followUpResult": null },
  "notes": "…", "createdAt": "…", "updatedAt": "…"
}
```

## Webhooks

Subscribe via `POST /api/v1/webhooks { url, events[] }` → returns `secret` once.

- Events: `lead.created`, `lead.updated`, `lead.sold`, `lead.lost`, `task.created`, `task.completed`
- Body: `{ id, type, createdAt, data }`; verify `x-leadflow-signature` = hex HMAC-SHA256(secret, raw body).
- Retries: 3 attempts with 1m/5m/25m backoff; log in `webhook_deliveries`.

## Zapier quick path

1. Zapier "Webhooks → Catch Hook" → copy URL → Settings → API & Webhooks → Add webhook.
2. Edit a lead → Zapier catches `lead.updated`. Map `data.contact.phone`, `data.estimate.outcome`, etc.
3. Inbound (CRM → LeadFlow): Zapier "POST" action → `POST /api/v1/leads` with the Bearer key.

## Migration

`supabase/migrations/20261121000001_api_platform.sql` — `api_keys`, `webhook_subscriptions`, `webhook_deliveries` (+ admin RLS). Run it against the project before deploying.
