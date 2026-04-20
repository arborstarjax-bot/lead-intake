# Lead Intake

Mobile-optimized, installable PWA for turning iPhone screenshots of estimate
requests into an editable, spreadsheet-style leads table.

## Core flow

1. Admin (or boss via a quick-upload link) uploads one or more screenshots.
2. Each screenshot is stored in a private Supabase bucket.
3. GPT-4o extracts lead fields and a `confidence` score per field.
4. A row lands in the spreadsheet; low-confidence fields are highlighted.
5. Admin fixes anything the model got wrong (inline, autosaved).
6. One-click actions call / text / email / add to Google Calendar /
   mark Completed. Completed leads move to a separate tab.

See the live deliverables doc for architecture, data model, API surface,
wireframes, and the MVP plan: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Stack

- Next.js 15 App Router (TypeScript, React 19)
- Supabase (Postgres, Storage, Auth, SSR)
- OpenAI GPT-4o (vision + structured JSON extraction)
- Google Calendar API (OAuth2 + events.insert)
- Tailwind CSS v4
- PWA via `manifest.ts` + `/public/sw.js`

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in Supabase, OpenAI, Google OAuth
npm run dev                  # http://localhost:3000
```

Before first run, apply the migration in `supabase/migrations/` to your
Supabase project — paste the SQL into the Supabase SQL editor, or run
`npx supabase db push`. No login is required; the app is single-user and
all mutations go through server routes authorized by the service-role key.
Treat the deployed URL as a secret — anyone with it can view/edit leads.

## Environment variables

| Name | Where to get it |
| ---- | --------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API (server-only) |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys (needs GPT-4o) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same |
| `LEAD_INTAKE_UPLOAD_TOKEN` | Any long random string; rotate by changing + redeploying |
| `NEXT_PUBLIC_APP_URL` | Public origin (e.g. `https://lead-intake.vercel.app`) |

## Boss quick-upload link

The homepage shows a bookmarkable URL of the form
`/u/<LEAD_INTAKE_UPLOAD_TOKEN>`. Text it to the boss; he opens it on his
iPhone, picks screenshots, and the images land in the leads table with no
login needed. Rotate the token if the link is ever exposed.

## Deploy

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add all env vars above to the Vercel project.
4. Add the production callback URL to Google OAuth:
   `https://<vercel-domain>/api/google/callback`.
5. Visit the site, sign in, and click “Connect Google Calendar”.
