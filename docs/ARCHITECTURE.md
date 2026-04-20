# Lead Intake — Architecture & MVP Plan

## 1. Recommended architecture

```
                              ┌──────────────────────────┐
                              │  iPhone (Safari)         │
                              │  - PWA installed to home │
                              │  - Quick-upload bookmark │
                              └────────────┬─────────────┘
                                           │ HTTPS
                                           ▼
┌────────────────────────────────────────────────────────────────┐
│  Next.js 15 (App Router, Vercel)                               │
│                                                                │
│  ├─ app/login                         Supabase email/password │
│  ├─ app/ (dashboard, 4 sections)      Auth-gated (middleware)  │
│  ├─ app/u/[token]                     Public, token-gated     │
│  │                                                              │
│  ├─ api/ingest                        Admin upload → pipeline  │
│  ├─ api/quick-upload/[token]          Boss upload → pipeline   │
│  ├─ api/leads (GET/POST)              List + add manual        │
│  ├─ api/leads/[id] (PATCH/DELETE)     Inline edits + delete    │
│  ├─ api/leads/[id]/screenshot         Signed-url redirect      │
│  ├─ api/leads/[id]/calendar           Create GCal event        │
│  ├─ api/google/connect|callback       OAuth2 flow              │
│  └─ api/google/status                 Connection state         │
└────────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
     ┌───────────────────────┴───────────────────────┐
     ▼                       ▼                       ▼
┌──────────┐          ┌──────────────┐         ┌──────────────┐
│ Supabase │          │  OpenAI      │         │  Google      │
│ Postgres │          │  GPT-4o      │         │  Calendar v3 │
│ + Storage│          │  (vision)    │         │              │
│ + Auth   │          └──────────────┘         └──────────────┘
└──────────┘
```

- **Hosting**: Vercel (free tier is fine for MVP).
- **DB + Auth + Storage**: one Supabase project.
- **AI**: OpenAI GPT-4o Chat Completions with `response_format=json_schema`.
- **Calendar**: Direct OAuth2 + REST to `calendar/v3/events`.
- **PWA**: `app/manifest.ts` + a tiny `/public/sw.js`.

## 2. Data model

Single `leads` table (see `supabase/migrations/20260420000001_init.sql`):

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid pk | |
| `created_at`, `updated_at` | timestamptz | trigger maintains `updated_at` |
| `date` | date | |
| `first_name`, `last_name` | text | stored separately |
| `client` | text | defaults to `first + last`, editable override |
| `phone_number` | text | stored E.164 when we can (`+1XXXXXXXXXX`) |
| `email` | text | normalized lowercase |
| `address`, `city`, `state`, `zip` | text | |
| `status` | enum | New / Called / No Response / Scheduled / Completed |
| `sales_person` | text | |
| `scheduled_day`, `scheduled_time` | date, time | blank is allowed |
| `notes` | text | free text extracted by AI or edited |
| `screenshot_path` | text | Supabase Storage key (private bucket) |
| `screenshot_url` | text | optional external reference |
| `extraction_confidence` | jsonb | per-field 0..1 |
| `calendar_event_id` | text | one per lead, enables dup prevention |
| `intake_source` | enum | web_upload / quick_link / email_ingest / manual |
| `intake_status` | enum | processing / needs_review / ready / failed |

Plus `google_oauth_tokens (user_id pk, access_token, refresh_token, expires_at)`.
A private storage bucket `lead-screenshots` holds the original images.

## 3. UI component structure

```
app/page.tsx
├── Header (title, Google connect state, sign out)
├── UploadBox          — drag/drop + click + multi-file, POSTs /api/ingest
├── InstallButton      — beforeinstallprompt → native install, iOS A2HS help
├── Quick-upload card  — shows bookmarkable /u/<token> URL + Copy
└── Tabs
    ├── View/Edit Leads  → LeadTable view="active"
    └── Completed Leads  → LeadTable view="completed"

LeadTable
├── Search input
├── Add Row
├── Spreadsheet table
│   ├── Sticky Actions column: Call / Text / Email / Calendar / Done /
│   │   View Screenshot / Delete
│   ├── Cell: inline edit, 500ms debounced autosave
│   ├── Status cell: dropdown (LEAD_STATUSES)
│   ├── Low-confidence cells highlighted amber
│   └── Sort by any column
└── Undo toast (6s) after Mark Completed
```

Quick-upload portal (`app/u/[token]`) reuses `UploadBox` against
`/api/quick-upload/[token]`. No other chrome, no login.

## 4. AI extraction flow

1. Admin or boss uploads 1+ images (JPG/PNG/HEIC). HEIC is converted to
   JPEG server-side via `heic-convert` (best-effort).
2. Each image is streamed to Supabase Storage (`lead-screenshots/<date>/<ts>-<name>`).
3. A 10-minute signed URL is generated and passed to GPT-4o with a strict
   JSON schema that forces `{field, confidence}` for every column.
4. The response is post-normalized: phone → E.164, email → lowercased,
   state → 2-letter, zip → 5/9-digit. `client` is derived from first+last.
5. Duplicate detection runs against active leads (phone/email = hard match,
   address/name = soft warning).
6. The row is inserted with `intake_status`:
   - `needs_review` if any phone/email field is low-confidence, the lead
     isn't saveable (no phone or email), or a duplicate exists.
   - `ready` otherwise.
7. On extraction failure we still insert a `failed` placeholder so no upload
   is silently lost — the user can open the screenshot and fill fields manually.

## 5. Google Calendar integration plan

- OAuth2 Web-app flow, scope `calendar.events`, `access_type=offline`,
  `prompt=consent` (so we always get a refresh token on reconnect).
- Tokens stored in `google_oauth_tokens` keyed by Supabase user id.
- `getAccessTokenForUser(userId)` refreshes tokens ~30s before expiry.
- `POST /api/leads/:id/calendar`:
  - 428 with `connectUrl` if the user hasn't connected Google yet
  - 400 if `scheduled_day` is blank or not `YYYY-MM-DD`
  - idempotent: if `calendar_event_id` already set, short-circuits
- Event fields:
  - `summary`: `First Last - Zip` (falls back to phone/email/"Estimate")
  - `description`: multi-line dump of every lead field + Notes
  - `location`: joined address/city/state/zip when present
  - `start`/`end`: 1-hour block at `scheduled_time` (defaults to 09:00)
  - `extendedProperties.private.leadId`: the lead id (traceability)
- On success the `calendar_event_id` is written back to the row and a new
  tab opens on the event's `htmlLink`.

## 6. Duplicate detection approach

On ingest and on manual-row save, `findDuplicates(candidate, activeLeads)`
returns matches by:

- **Phone** (E.164 normalized) — hard duplicate.
- **Email** (lowercased) — hard duplicate.
- **Address** (trimmed, lowercased) — soft warning.
- **First + Last name** (lowercased) — soft warning.

Completed leads are excluded from comparison. For the MVP, hard duplicates
flip `intake_status=needs_review` so the row shows up tinted in the table;
the admin can then delete or merge manually. No silent merges.

## 7. Quick-share upload design for iPhone

`GET /u/<LEAD_INTAKE_UPLOAD_TOKEN>` renders a single-screen page with only
the upload box. The token:

- lives in env var (rotatable without code changes)
- is compared constant-time
- is also validated on the POST endpoint `/api/quick-upload/<token>`
- is emitted to the admin homepage behind auth so only the admin sees it

Flow on iPhone:

1. Boss taps bookmark or iMessage link.
2. Page shows a single "Send a lead" box.
3. He taps the box → iOS shows camera roll / files / camera sheet.
4. Selected images upload in the background; HEIC converts to JPEG.
5. He sees a per-file status (added / needs review / error).

Email-to-ingest (fallback path) is a planned extension: a Resend inbound
route pointed at `/api/email-ingest` would attach `message.attachments` to
the same `ingestScreenshot` pipeline with `intake_source='email_ingest'`.
Not included in the MVP; scaffolding is compatible.

## 8. PWA / installable app plan

- `app/manifest.ts` exports a `Manifest` with `display: standalone`,
  portrait orientation, maskable + any-purpose icons.
- `<link rel="apple-touch-icon">` + `appleWebApp: { capable: true }` in
  root metadata so iOS treats it as a native-like app.
- `/public/sw.js` registers on load. It does NOT precache HTML (stale
  table data would hide new leads). It only caches static assets.
- `InstallButton`:
  - Chromium / Android: captures `beforeinstallprompt`, prompts on click.
  - iOS Safari: no such event → shows an in-app sheet with
    "tap Share → Add to Home Screen" instructions.
  - Hides itself when `display-mode: standalone` is detected.

## 9. MVP implementation plan

1. **DB**: apply the migration (`leads`, `google_oauth_tokens`, storage bucket).
2. **Auth**: create the admin user in Supabase Auth. No signup UI — single user.
3. **Ingest**: `/api/ingest` + `/api/quick-upload/[token]`, pipeline in
   `src/lib/ingest.ts` (upload → sign → extract → normalize → insert).
4. **Table**: `LeadTable` with debounced autosave, sticky actions column,
   low-confidence highlighting, tab separation of active vs. completed.
5. **One-click actions**: `tel:`, `sms:`, `mailto:`, Add to Calendar,
   Mark Completed with undo.
6. **PWA**: manifest + service worker + install button.
7. **Quick-upload portal**: `/u/[token]` page.
8. **Google Calendar**: OAuth connect + event insert with idempotency.
9. **Deploy**: Vercel + env vars + add prod callback to Google OAuth client.
10. **Test**: end-to-end with a real iPhone screenshot; record the flow.

## 10. Production-ready code scaffold

Already in this repo:

- `src/app/` — all routes above.
- `src/lib/ai/extract.ts` — GPT-4o + strict JSON schema.
- `src/lib/google/{oauth,calendar}.ts` — OAuth + event insert.
- `src/lib/ingest.ts` — full ingest pipeline.
- `src/lib/dedupe.ts` — duplicate detection + saveability rule.
- `src/lib/format.ts` — phone / email / state / zip normalization.
- `src/components/{UploadBox,LeadTable,InstallButton}.tsx`.
- `src/middleware.ts` — auth + public-route allowlist.
- `supabase/migrations/20260420000001_init.sql` — schema + RLS + bucket.

## Future extensions (not MVP)

- Real-time updates via Supabase Realtime so uploads by the boss appear in
  the admin table without polling.
- Email-to-ingest endpoint (Resend inbound parsing).
- Per-user sales_person scoping + simple "my leads" filter.
- CSV export.
- Metrics dashboard (time-to-first-call, conversion).
