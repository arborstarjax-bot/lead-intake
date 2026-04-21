# Capacitor — iOS & Android wrappers

LeadFlow ships to the Apple App Store and Google Play as Capacitor wrappers
around the hosted Vercel web app. The webview loads the production URL
directly — no static export, no duplicate bundles. Every `main` deploy is
live on mobile instantly. Capacitor gives us enough native surface
(push notifications, in-app purchase, haptics, status bar) to satisfy
App Store review guidelines that "thin webviews" get rejected.

## Why this architecture

| Option | Pros | Cons |
|---|---|---|
| **`server.url` → hosted Vercel** (current) | No duplicate builds, web deploys ship to mobile, Next.js SSR / API routes work unmodified | Need online; offline caching is whatever the PWA service worker provides |
| Static-export (`next export`) bundled in app | Works offline from the bundle | Most Next 15 features break; we lose SSR auth, middleware, API routes |
| Dual web + native-redux app | Rich offline, native-feeling perf | 2-3× engineering cost, two codebases |

We're using option 1 until there's a concrete reason to go heavier.

## Repo scaffold (done)

- `capacitor.config.ts` — points to `https://lead-intake-sooty.vercel.app` in prod, `CAP_DEV_URL` override for LAN dev
- `package.json` adds `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`, and plugins (`app`, `browser`, `haptics`, `push-notifications`, `status-bar`)
- `cap:sync` / `cap:ios` / `cap:android` npm scripts

## One-time native platform setup (NOT yet done — needs a Mac)

Capacitor auto-generates native projects in `ios/` and `android/`. These contain Xcode / Android Studio project files and are required for archiving / signing / uploading to the stores.

### macOS (for iOS + Android)

```bash
npm install                      # picks up Capacitor deps
npx cap add ios
npx cap add android
npx cap sync
```

Committed artifacts:
- `ios/App/` — Xcode project. Safe to commit. Signing is handled via Xcode automatic signing on the developer machine (never commit provisioning profiles or certificates).
- `android/` — Android Studio / Gradle project. Safe to commit. `google-services.json` (for FCM push) is secrets — use `.gitignore` + Vercel env vars pattern.

### Linux / Windows

Only Android can be built here:
```bash
npx cap add android
npx cap sync
```

iOS builds and App Store uploads require macOS + Xcode, full stop. CI path: use **EAS Build** (paid) or a self-hosted Mac runner.

## Environment separation

- **Dev**: `CAP_DEV_URL=http://192.168.x.y:3000` then `npx cap run ios -l --external` → live-reload against local `next dev`
- **Staging** (future): point to a staging Vercel domain with its own Supabase env
- **Prod**: no env var set → uses `https://lead-intake-sooty.vercel.app`

## In-app purchase (IAP)

iOS and Android both **require** native IAP for digital subscriptions (Apple Guideline 3.1.1, Google equivalent). Stripe can't be used for web-style checkout inside the apps.

Plan:
1. Use **RevenueCat** (`@revenuecat/purchases-capacitor`) — wraps Apple StoreKit + Google Play Billing with one JS API, handles receipt verification, sends webhooks to our server that we can idempotency-key against `billing_events` (same table as Stripe flow).
2. Map RevenueCat "entitlements" to the same `workspaces.plan` column as Stripe: `starter` / `pro`.
3. Separate price IDs in App Store Connect + Google Play Console matching the web SKUs. Apple takes 30% (15% via Small Business Program after year 1); Google takes 15% on the first $1M/yr.
4. UI: `/billing` page detects `Capacitor.isNativePlatform()` and hides the Stripe upgrade button in favor of a native IAP button on mobile. Web users still see Stripe Checkout.

This happens in a separate PR **after** the Stripe flow lands.

## Push notifications

- **Web**: existing `web-push` + VAPID is unaffected.
- **iOS**: `@capacitor/push-notifications` uses APNs. Need an Apple Push Notification key (`.p8`) uploaded to the Firebase / APNs backend. Device tokens hit the existing `push_subscriptions` table with a new `platform: 'ios'` column.
- **Android**: FCM via the same plugin. Needs `google-services.json`.

New migration for this (deferred until we actually need push from mobile):
```sql
alter table public.push_subscriptions
  add column platform text not null default 'web'
    check (platform in ('web', 'ios', 'android'));
```

## App Store submission checklist (when ready)

- [ ] Apple Developer Program account ($99/yr)
- [ ] Bundle ID `com.leadflow.app` registered
- [ ] App Store Connect app created
- [ ] Pricing tier in App Store Connect matches web tiers (Apple will reject large disparities)
- [ ] Privacy policy URL (already have at `/privacy`)
- [ ] ToS URL (already have at `/terms`)
- [ ] Screenshots at required device sizes
- [ ] App review information: provide a test account that's pre-paid on the Pro tier so reviewers don't hit the paywall
- [ ] TestFlight build for 1+ week of internal testing before submission

## Google Play submission checklist

- [ ] Google Play Developer account ($25 one-time)
- [ ] Package name `com.leadflow.app`
- [ ] Internal testing track with 20+ opt-in testers for 14 days (required for new accounts after Nov 2023)
- [ ] Data safety disclosure (mirrors `/privacy`)
- [ ] Content rating questionnaire
- [ ] Screenshots at required device sizes
