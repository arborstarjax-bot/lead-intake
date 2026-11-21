# LeadFlow

Mobile-optimized, installable PWA + iOS app (Capacitor) for home-services
companies and sales reps: turn screenshots of estimate requests into an
editable leads table, then plan a day of estimate stops on an optimized
route.

Multi-tenant SaaS — each company gets a workspace with its own members,
settings, lead sources, and Stripe-billed plan.

## Core flow

1. Upload one or more screenshots (or paste the lead text).
2. Each screenshot is stored in a private Supabase bucket.
3. GPT-4o extracts lead fields and a `confidence` score per field.
4. A row lands in the leads table; low-confidence fields are highlighted.
5. Fix anything the model got wrong (inline, autosaved).
6. One-click actions call / text / email / schedule the estimate /
   mark the outcome. The Route view orders the day's stops by drive
   time. Completed leads move to a separate tab.

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
`npx supabase db push`. Users sign up, create or join a workspace, and
every query is scoped to that workspace.

## Environment variables

| Name | Where to get it |
| ---- | --------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API (server-only) |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys (needs GPT-4o) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same |
| `NEXT_PUBLIC_APP_URL` | Public origin (e.g. `https://lead-intake.vercel.app`) |

## Deploy

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add all env vars above to the Vercel project.
4. Add the production callback URL to Google OAuth:
   `https://<vercel-domain>/api/google/callback`.
5. Visit the site, sign in, and click “Connect Google Calendar”.
