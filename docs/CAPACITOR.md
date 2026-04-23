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

After `cap add ios` generates the project, follow `docs/IOS_SHELL_SETUP.md`
for the required post-generation edits (WKWebView UA marker, Info.plist
permission strings, launch screen, app icons, push capability).

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

## Billing — App Store Guideline 3.1.1 / 3.1.3(b)

LeadFlow does **not** use native IAP (StoreKit / Play Billing). We qualify
for the **3.1.3(b) business-services exemption**: a multi-user B2B CRM
where accounts and seats are provisioned by a workspace admin, not by
end users. Under that exemption purchase and billing management happen
outside the app — on the web — and the app must not present any
in-app purchase or Stripe portal UI.

How that's enforced in the code (shipped across #147–#156):

1. `src/lib/ios-shell.ts` is the single source of truth for "is this a
   native shell?" — `isIosShellUserAgent` matches the shell's WKWebView
   UA (`Capacitor/*` and the explicit `LeadFlowiOS/*` marker from
   `AppDelegate.swift` — see `IOS_SHELL_SETUP.md`).
2. `src/lib/ios-shell-server.ts` exposes `isIosShellRequest()` for
   server components; `src/lib/use-ios-shell.ts` exposes
   `useIsIosShell()` for client components and prefers the canonical
   `window.Capacitor.isNativePlatform()` check.
3. Every billing CTA is gated:
   - `/billing` page — `PlanCompareCard` + `ManageBillingButton` are
     replaced by `WebManagedBillingNote` when `inShell` is true.
   - `TrialEndingBanner`, `PastDueBanner`, `LapsedBanner` — admin
     copy rewrites to "open LeadFlow in a web browser …" and any
     Stripe-portal button (e.g. "Update payment method") is
     suppressed.
   - `UploadBox` daily-cap dialog and subscription-lapsed dialog —
     the "Upgrade to Pro" / "Go to billing" buttons are suppressed
     and the body copy directs the user to the web.

If App Review challenges the 3.1.3(b) claim during submission, the
argument is: (a) workspace creation requires an admin, (b) free-tier
users can not self-upgrade to a paid plan from inside the app at all,
(c) billing management is read-only on mobile, (d) there are no
individual "buy" flows. The app is a thin mobile surface for a B2B
tool whose purchasing happens in the web dashboard, identical to
Slack / Asana / Notion's mobile apps.

Do **not** re-add RevenueCat / native IAP without first re-reading
this section — the B2B exemption is the agreed path.

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
- [ ] Bundle ID `com.arborcore.leadflow` registered
- [ ] App Store Connect app created
- [ ] Pricing tier in App Store Connect matches web tiers (Apple will reject large disparities)
- [ ] Privacy policy URL (already have at `/privacy`)
- [ ] ToS URL (already have at `/terms`)
- [ ] Screenshots at required device sizes
- [ ] App review information: provide a test account that's pre-paid on the Pro tier so reviewers don't hit the paywall
- [ ] TestFlight build for 1+ week of internal testing before submission

## Google Play submission checklist

- [ ] Google Play Developer account ($25 one-time)
- [ ] Package name `com.arborcore.leadflow`
- [ ] Internal testing track with 20+ opt-in testers for 14 days (required for new accounts after Nov 2023)
- [ ] Data safety disclosure (mirrors `/privacy`)
- [ ] Content rating questionnaire
- [ ] Screenshots at required device sizes
