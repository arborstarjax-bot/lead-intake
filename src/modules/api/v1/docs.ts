/**
 * Endpoint registry rendered by /api-docs. Hand-maintained beside the
 * routes — keeping it here (not in the page) means the docs list doubles
 * as the machine-readable contract inventory for future OpenAPI export.
 */
export type ApiDocEndpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  scope: string;
  params?: { name: string; in: "query" | "path" | "body"; type: string; required?: boolean; description: string }[];
  responseExample: string;
  requestExample?: string;
};

export type ApiDocGroup = { name: string; description: string; endpoints: ApiDocEndpoint[] };

export const API_DOCS: ApiDocGroup[] = [
  {
    name: "Leads",
    description: "Create, read, update and delete lead records. Every write also fires webhook events.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/leads", scope: "leads:read",
        summary: "List leads (cursor-paginated)",
        params: [
          { name: "limit", in: "query", type: "integer", description: "1–100, default 50" },
          { name: "cursor", in: "query", type: "string", description: "next_cursor from a previous page" },
          { name: "updated_since", in: "query", type: "ISO 8601", description: "Only leads changed after this time — use for sync" },
          { name: "status", in: "query", type: "string", description: "Exact status filter (e.g. New, Scheduled, Pending)" },
        ],
        responseExample: `{ "data": [ { "id": "…", "contact": { "name": "Maria Torres", "phone": "+1…", "email": "…", "address": { "line1": "…", "city": "…", "state": "FL", "zip": "…" } }, "source": "Thumbtack", "status": "Scheduled", "assignee": "David", "estimate": { "scheduledDay": "2026-11-23", "scheduledTime": "08:00", "outcome": null }, "notes": "…" } ], "meta": { "next_cursor": "…", "has_more": true } }`,
      },
      {
        method: "POST", path: "/api/v1/leads", scope: "leads:write",
        summary: "Create a lead",
        requestExample: `{ "firstName": "Jane", "lastName": "Doe", "phone": "(555) 123-4567", "email": "jane@x.com", "address": "123 Main St", "city": "Springfield", "state": "FL", "zip": "32003", "source": "Website", "type": "Residential", "notes": "…" }`,
        responseExample: `{ "data": { "id": "…", "contact": {…}, "status": "New", … } }`,
      },
      {
        method: "GET", path: "/api/v1/leads/{id}", scope: "leads:read",
        summary: "Get one lead",
        params: [{ name: "id", in: "path", type: "uuid", required: true, description: "Lead id" }],
        responseExample: `{ "data": { "id": "…", "contact": {…}, … } }`,
      },
      {
        method: "PATCH", path: "/api/v1/leads/{id}", scope: "leads:write",
        summary: "Update a lead (partial). Setting estimateOutcome to 'Sold' fires lead.sold; status 'Lost' fires lead.lost.",
        requestExample: `{ "status": "Scheduled", "estimate": { }, "estimateOutcome": "Sold", "assignee": "David" }`,
        responseExample: `{ "data": { "id": "…", … } }`,
      },
      {
        method: "DELETE", path: "/api/v1/leads/{id}", scope: "leads:write",
        summary: "Delete a lead",
        responseExample: `{ "data": { "deleted": true } }`,
      },
      {
        method: "GET", path: "/api/v1/leads/{id}/activities", scope: "leads:read",
        summary: "Lead activity timeline (intake, status changes, outcomes)",
        responseExample: `{ "data": [ { "id": "…", "type": "lead_scheduled", "label": "Lead scheduled", "details": {…}, "createdAt": "…" } ] }`,
      },
    ],
  },
  {
    name: "Tasks",
    description: "Scheduled tasks / to-dos (site visits, callbacks, chores) with recurrence.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/tasks", scope: "tasks:read",
        summary: "List tasks (cursor-paginated, same params as leads)",
        responseExample: `{ "data": [ { "id": "…", "name": "Site inspection", "status": "Scheduled", "window": { "startAt": "…", "endAt": "…", "recurrence": "weekly" }, "address": {…}, "assignee": "David" } ], "meta": {…} }`,
      },
      {
        method: "POST", path: "/api/v1/tasks", scope: "tasks:write",
        summary: "Create a task",
        requestExample: `{ "name": "Follow-up call", "startAt": "2026-11-24T14:00:00Z", "endAt": "2026-11-24T14:30:00Z", "recurrence": "weekly", "assignee": "David" }`,
        responseExample: `{ "data": { "id": "…", … } }`,
      },
      {
        method: "GET", path: "/api/v1/tasks/{id}", scope: "tasks:read",
        summary: "Get one task",
        responseExample: `{ "data": { "id": "…", … } }`,
      },
      {
        method: "PATCH", path: "/api/v1/tasks/{id}", scope: "tasks:write",
        summary: "Update a task. Marking status 'Completed' fires task.completed.",
        requestExample: `{ "status": "Completed" }`,
        responseExample: `{ "data": { "id": "…", "status": "Completed", … } }`,
      },
      {
        method: "DELETE", path: "/api/v1/tasks/{id}", scope: "tasks:write",
        summary: "Delete a task",
        responseExample: `{ "data": { "deleted": true } }`,
      },
    ],
  },
  {
    name: "Workspace & Members",
    description: "Read-only org info — the workspace an API key belongs to and its members.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/workspace", scope: "workspace:read",
        summary: "Workspace name, join code, creation date",
        responseExample: `{ "data": { "id": "…", "name": "Devin Smoke Co", "joinCode": "XDH58UJ8" } }`,
      },
      {
        method: "GET", path: "/api/v1/members", scope: "workspace:read",
        summary: "Members with emails and roles",
        responseExample: `{ "data": [ { "userId": "…", "email": "…", "role": "admin", "joinedAt": "…" } ] }`,
      },
      {
        method: "PATCH", path: "/api/v1/members/{userId}", scope: "members:write",
        summary: "Promote/demote a member (admin only; can't self-edit or orphan the workspace)",
        requestExample: `{ "role": "admin" }`,
        responseExample: `{ "data": { "ok": true } }`,
      },
      {
        method: "DELETE", path: "/api/v1/members/{userId}", scope: "members:write",
        summary: "Remove a member from the workspace (admin only)",
        responseExample: `{ "data": { "ok": true } }`,
      },
    ],
  },
  {
    name: "Schedule",
    description: "Day routing and AI scheduling — the same engine the Route page uses. Maps-dependent endpoints need GOOGLE_MAPS_API_KEY; calendar sync needs a signed-in user (API keys have no Google token).",
    endpoints: [
      {
        method: "GET", path: "/api/v1/schedule/day", scope: "schedule:read",
        summary: "Ordered stops + drive legs for one day",
        params: [{ name: "date", in: "query", type: "string", description: "YYYY-MM-DD; defaults to today (workspace timezone)" }],
        responseExample: `{ "data": { "date": "2026-11-23", "hasHome": true, "stops": [ { "id": "…", "label": "Jane Doe", "address": "…", "startTime": "08:00", "endTime": "09:00", "driveMinutesFromPrev": 14 } ], "totalDriveMinutes": 68, "returnDriveMinutes": 22 } }`,
      },
      {
        method: "POST", path: "/api/v1/schedule/preview", scope: "schedule:read",
        summary: "Rank upcoming work days by drive time for a lead",
        requestExample: `{ "leadId": "…", "horizonDays": 14 }`,
        responseExample: `{ "data": { "days": [ { "date": "…", "isWorkDay": true, "bestTotalDriveMinutes": 31, "slotCount": 6, "routeScore": 78 } ] } }`,
      },
      {
        method: "POST", path: "/api/v1/schedule/suggest", scope: "schedule:read",
        summary: "Ranked time slots for a lead on a day",
        requestExample: `{ "leadId": "…", "half": "morning", "day": "2026-11-24", "offset": 0 }`,
        responseExample: `{ "data": { "slots": [ { "startTime": "08:30", "totalDriveMinutes": 27 } ], "hasMore": true } }`,
      },
      {
        method: "POST", path: "/api/v1/schedule/book", scope: "schedule:read",
        summary: "Smart Booking — morning/afternoon top-3 recommendations",
        requestExample: `{ "leadId": "…", "mode": "balanced", "day": "2026-11-24" }`,
        responseExample: `{ "data": { "bestOverall": {…}, "morningTop3": […], "afternoonTop3": […] } }`,
      },
      {
        method: "POST", path: "/api/v1/schedule/reorder", scope: "schedule:write",
        summary: "Re-time a day's stops in a new order (compact from work start, real drive legs)",
        requestExample: `{ "date": "2026-11-23", "orderedLeadIds": ["…","…"], "sync": true }`,
        responseExample: `{ "data": { "shifted": 3, "overflowMinutes": 0, "calendarConnected": true, "results": […] } }`,
      },
      {
        method: "POST", path: "/api/v1/schedule/sync", scope: "schedule:write",
        summary: "Batch-sync a day's stops to Google Calendar (session auth only)",
        requestExample: `{ "date": "2026-11-23" }`,
        responseExample: `{ "data": { "summary": { "total": 4, "created": 1, "updated": 2, "already": 1, "errors": 0 }, "results": […] } }`,
      },
    ],
  },
  {
    name: "Settings & Reports",
    description: "Workspace configuration snapshot and the lead→estimate funnel summary.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/settings", scope: "settings:read",
        summary: "Work hours, scheduling defaults, company info, salespeople, lead sources, message templates",
        responseExample: `{ "data": { "timezone": "America/New_York", "workDays": [1,2,3,4,5], "company": {…}, "salespeople": ["David"], "leadSources": […] } }`,
      },
      {
        method: "PATCH", path: "/api/v1/settings", scope: "settings:write",
        summary: "Update settings (admin fields; any member may edit leadSources)",
        requestExample: `{ "workStartTime": "8:00 AM", "workDays": [1,2,3,4,5], "leadSources": ["Website", "Referral"] }`,
        responseExample: `{ "data": { "timezone": "America/New_York", … } }`,
      },
      {
        method: "GET", path: "/api/v1/reports/summary", scope: "reports:read",
        summary: "Funnel numbers for a rolling window",
        params: [{ name: "days", in: "query", type: "integer", description: "Look-back window, default 30, max 365" }],
        responseExample: `{ "data": { "windowDays": 30, "totalLeads": 42, "estimatesSent": 20, "estimatesAccepted": 9, "closeRate": 45 } }`,
      },
    ],
  },
  {
    name: "Webhooks",
    description: "Subscribe an HTTPS endpoint to workspace events. Each delivery is POSTed as JSON with an HMAC-SHA256 signature in the x-leadflow-signature header (verify with the secret returned at creation). Failed deliveries retry with backoff.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/webhooks", scope: "webhooks:manage",
        summary: "List subscriptions",
        responseExample: `{ "data": [ { "id": "…", "url": "https://…", "events": ["lead.created"], "isActive": true } ] }`,
      },
      {
        method: "POST", path: "/api/v1/webhooks", scope: "webhooks:manage",
        summary: "Create a subscription. The signing secret is returned once.",
        requestExample: `{ "url": "https://hooks.zapier.com/…", "events": ["lead.created", "lead.sold"] }`,
        responseExample: `{ "data": { "id": "…", "secret": "whsec_…" } }`,
      },
      {
        method: "PATCH", path: "/api/v1/webhooks/{id}", scope: "webhooks:manage",
        summary: "Update URL, events, or isActive",
        responseExample: `{ "data": { "id": "…", "isActive": false } }`,
      },
      {
        method: "DELETE", path: "/api/v1/webhooks/{id}", scope: "webhooks:manage",
        summary: "Delete a subscription",
        responseExample: `{ "data": { "deleted": true } }`,
      },
    ],
  },
];

export const WEBHOOK_EVENT_DOCS: { event: string; when: string }[] = [
  { event: "lead.created", when: "A lead is created (web, paste/upload intake, or API)" },
  { event: "lead.updated", when: "Any lead field changes" },
  { event: "lead.sold", when: "estimate_outcome becomes Sold" },
  { event: "lead.lost", when: "status becomes Lost" },
  { event: "task.created", when: "A task is created" },
  { event: "task.completed", when: "A task transitions to Completed" },
];
