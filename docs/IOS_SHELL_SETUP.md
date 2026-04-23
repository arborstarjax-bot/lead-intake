# iOS Shell Setup Runbook

Step-by-step for taking LeadFlow from "Next.js app on Vercel" to
"TestFlight build ready for App Review." Follow top to bottom. Every
step has a checkbox; check things off as you go so a partial run is
resumable.

**Who's doing what:**

- 🧑‍💻 = you, at the Mac
- 🤖 = I can do on this Linux VM (PRs I'll ship when you green-light a
  step)
- ☁️ = Apple Developer portal / App Store Connect web UI (you, on any
  machine)

Prerequisites:
- [x] Apple Developer Program membership ($99/yr) — confirmed done.
- [ ] macOS 14+ with Xcode 15+ installed (`xcode-select --install` run
      at least once so the Command Line Tools are present).
- [ ] CocoaPods (`sudo gem install cocoapods` or `brew install
      cocoapods`) — `cap add ios` will fail without it.
- [ ] A physical iPhone on iOS 17+ to run the dev build through Xcode
      before TestFlight. Simulator works for most testing, but APNs
      push only fires on a physical device.

---

## 0. Generate the native project (Mac, ~5 min)

🧑‍💻 **On your Mac**, clone and cd into the repo, then:

```bash
npm install
npx cap add ios
npx cap sync ios
```

The `cap add ios` command creates the `ios/` directory with
`App/App.xcodeproj`, `App/App.xcworkspace`, `App/App/AppDelegate.swift`,
`App/App/Info.plist`, `App/Podfile`, etc. **Commit the entire `ios/`
directory** (except the excluded files listed in the Capacitor-generated
`ios/.gitignore` — leave it as-is; don't hand-edit).

```bash
git add ios
git commit -m "Phase 2: add iOS platform via `cap add ios`"
git push
```

Open the PR and let me know when it's merged. From that point on 🤖 I
can edit `AppDelegate.swift`, `Info.plist`, `LaunchScreen.storyboard`,
`Assets.xcassets/AppIcon.appiconset/` on this Linux VM — they're text
/ plist / PNG files.

---

## 1. WKWebView user-agent marker (🤖, after step 0)

The `ios-shell` detector in `src/lib/ios-shell.ts` matches two strings:
`Capacitor/*` (always present in a Capacitor WKWebView) and the more
explicit `LeadFlowiOS/<version>`. The explicit marker is what we use to
disambiguate LeadFlow's shell from any random third-party Capacitor
build that ever hits the deployment.

The edit 🤖 will make to `ios/App/App/AppDelegate.swift`:

```swift
// Near the top of application(_:didFinishLaunchingWithOptions:)
import WebKit

let bundleVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
let appendedUA = "LeadFlowiOS/\(bundleVersion)"
UserDefaults.standard.register(defaults: [
    "UserAgent": (WKWebView().value(forKey: "userAgent") as? String ?? "") + " " + appendedUA
])
```

Then in `capacitor.config.ts` (🤖 can do this from Linux, but waits for
the ios/ directory so the change is grouped):

```ts
ios: {
  ...,
  appendUserAgent: `LeadFlowiOS/${process.env.npm_package_version ?? "0.0.0"}`,
},
```

`appendUserAgent` is the Capacitor-supported hook. We keep both —
the Swift override is belt-and-braces in case Capacitor's config path
is skipped for some reason.

After the edit, re-run `npx cap sync ios` on your Mac.

---

## 2. `Info.plist` permission strings (🤖)

Apple **rejects** any app that requests a permission without a
user-facing `NS...UsageDescription` string. The strings must be
specific (not "we need this to function") or Review will bounce.

🤖 will add these keys to `ios/App/App/Info.plist`:

| Key | Value | Why |
|---|---|---|
| `NSCameraUsageDescription` | "LeadFlow uses the camera to attach photos to customer leads." | `UploadBox` camera capture + lead photos |
| `NSPhotoLibraryUsageDescription` | "LeadFlow reads screenshots and photos from your library to import lead details." | Screenshot upload flow (ingest) |
| `NSPhotoLibraryAddUsageDescription` | "LeadFlow saves exported route maps and receipts to your photo library." | Route screenshot export |
| `NSLocationWhenInUseUsageDescription` | "LeadFlow uses your location to order the day's stops and estimate drive times." | `/route` live nav |
| `NSContactsUsageDescription` | *(not set)* | We don't touch the address book. Leave this key out. |
| `UIBackgroundModes` | `remote-notification` | APNs silent-push support |
| `UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes` | `false` | Avoid iPadOS multitasking review bumps until we test it |

After the edit, open the project in Xcode once and build to confirm
the plist parses (Xcode is strict about key ordering + types).

---

## 3. Launch screen (🤖 + 🧑‍💻 for Xcode preview)

The auto-generated `ios/App/App/Base.lproj/LaunchScreen.storyboard` is
a blank white page. App Review accepts it but the first-launch
experience is ugly. 🤖 will replace it with a storyboard that:

- Fills the screen with `#166534` (the PWA brand green).
- Centers the `Assets.xcassets/Splash.imageset/splash.png` logo mark
  (LeadFlow leaf, white).
- Uses auto-layout constraints so it scales from iPhone SE to iPad
  Pro.

Storyboard is XML — editable from Linux. 🤖 also drops the
`splash.png` @1x / @2x / @3x assets into `Splash.imageset/`, derived
from `public/logo-mark.png`.

🧑‍💻 Open the storyboard in Xcode once (**right-click →
LaunchScreen.storyboard → Open As → Interface Builder**) to confirm
it renders. If it looks off, tell me and I'll adjust the constraints.

---

## 4. App icon set (🤖, ready now)

Apple requires a specific set of icon sizes in
`Assets.xcassets/AppIcon.appiconset/`. Generating them by hand is
tedious; 🤖 can do it from Linux using `sharp` or `ImageMagick` against
your existing `public/icon-512.png` and the 1024×1024 source if you
have one.

Required sizes (all PNG, **no transparency**, **no rounded corners** —
iOS masks them automatically):

| File | Size | Usage |
|---|---|---|
| `AppIcon-20@2x.png` | 40×40 | Notification iPhone |
| `AppIcon-20@3x.png` | 60×60 | Notification iPhone |
| `AppIcon-29@2x.png` | 58×58 | Settings iPhone |
| `AppIcon-29@3x.png` | 87×87 | Settings iPhone |
| `AppIcon-40@2x.png` | 80×80 | Spotlight iPhone |
| `AppIcon-40@3x.png` | 120×120 | Spotlight iPhone |
| `AppIcon-60@2x.png` | 120×120 | Home screen iPhone |
| `AppIcon-60@3x.png` | 180×180 | Home screen iPhone |
| `AppIcon-20@1x.png` | 20×20 | Notification iPad |
| `AppIcon-20@2x-ipad.png` | 40×40 | Notification iPad |
| `AppIcon-29@1x.png` | 29×29 | Settings iPad |
| `AppIcon-29@2x-ipad.png` | 58×58 | Settings iPad |
| `AppIcon-40@1x.png` | 40×40 | Spotlight iPad |
| `AppIcon-40@2x-ipad.png` | 80×80 | Spotlight iPad |
| `AppIcon-76@1x.png` | 76×76 | Home screen iPad |
| `AppIcon-76@2x.png` | 152×152 | Home screen iPad |
| `AppIcon-83.5@2x.png` | 167×167 | Home screen iPad Pro |
| `AppIcon-1024.png` | 1024×1024 | App Store marketing |

Plus the `Contents.json` manifest that maps each size to its slot.

**One caveat:** the 1024×1024 App Store marketing icon is the one
Apple displays in search. If your source is upsampled from 512×512
it'll look soft. If you have a higher-resolution logo, drop it at
`public/icon-1024.png` before I run the generation and I'll use that.

🤖 will ship this as part of the phase-2 PR so it's ready the moment
`cap add ios` lands.

---

## 5. Push notifications (🤖 + 🧑‍💻 + ☁️)

Split into four sub-steps because each has a different blocker.

### 5a. Schema migration (🤖)

The existing `push_subscriptions` table was built for web push
(VAPID / browser endpoints). Native APNs tokens are different: a
64-char hex string, no endpoint URL, keyed by `device_token` instead.

🤖 adds a migration under `supabase/migrations/`:

```sql
alter table public.push_subscriptions
  add column platform text not null default 'web'
    check (platform in ('web', 'ios', 'android'));

alter table public.push_subscriptions
  add column device_token text;

alter table public.push_subscriptions
  add column app_version text;

create unique index if not exists push_subscriptions_device_token_uq
  on public.push_subscriptions (workspace_id, device_token)
  where device_token is not null;
```

Backfill existing rows with `platform = 'web'` (default handles it).

### 5b. `/api/push/subscribe` accepts `platform` + `device_token` (🤖)

Current route only accepts `{ endpoint, keys }` from the Web Push API.
🤖 extends the payload schema:

```ts
type SubscribeBody =
  | { platform: "web"; endpoint: string; keys: { p256dh: string; auth: string } }
  | { platform: "ios" | "android"; device_token: string; app_version?: string };
```

Dispatch on `platform` to store in the right columns, keep the
existing web path unchanged.

### 5c. Native push registration (🤖, after `ios/` lands)

`src/components/EnableNotifications.tsx` today only knows about web
push. 🤖 extends it:

```ts
import { PushNotifications } from "@capacitor/push-notifications";
import { isIosShellWindow } from "@/lib/ios-shell";

async function subscribe() {
  if (isIosShellWindow()) {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    await PushNotifications.register();
    PushNotifications.addListener("registration", async (token) => {
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "ios",
          device_token: token.value,
          app_version: "0.0.0",  // replaced by actual bundle short version
        }),
      });
    });
    return;
  }
  // existing web push path (unchanged)
}
```

### 5d. APNs credentials (☁️ + secret request)

To mint APNs tokens server-side you need three things from Apple:

1. **Team ID** — shown at
   [developer.apple.com/account](https://developer.apple.com/account)
   top-right (10-character alphanumeric).
2. **Key ID** — create at Apple Developer → Certificates, Identifiers &
   Profiles → **Keys** → the blue "+" → check "Apple Push Notifications
   service (APNs)" → Continue → give it a name like "LeadFlow APNs" →
   Register. Save the Key ID (10-character) shown on the confirmation
   page.
3. **`.p8` private key** — the same page gives you **one chance** to
   download a `.p8` file. Save it immediately; Apple won't let you
   re-download.

When you have all three, I'll request them through the secrets tool so
they land in the Vercel env (not the repo). The push-send endpoint
will sign a JWT using the `.p8` and hit APNs.

---

## 6. App Store Connect — app record (☁️ + 🤖 copy prep)

☁️ In App Store Connect → **My Apps** → **+** → **New App**:

- Platform: iOS
- Name: `LeadFlow` (reserve this now even if not shipping for weeks —
  names are first-come-first-served)
- Primary language: English (U.S.)
- Bundle ID: register `com.arborcore.leadflow` in Developer Portal first
  (Certificates, Identifiers & Profiles → Identifiers → "+" → App IDs).
  Once registered it shows up in the App Store Connect dropdown.
- SKU: `leadflow-ios` (internal, free form)
- User access: Full

Then in the app's Connect page, fill:

- **App Information**
  - Subtitle (30 char): "CRM for tree & service pros"
  - Privacy Policy URL: `https://lead-intake-sooty.vercel.app/privacy`
  - Category: Business (primary) / Productivity (secondary)
- **App Privacy** — declare what you collect (see section 7 below).
- **Pricing and Availability** — Free (IAP handled via web, not here).
- **Version 1.0 Prepare for Submission**
  - What's New: "LeadFlow for iOS — manage leads, route stops, and
    sync with your team on the go."
  - Description: 🤖 can draft from `/privacy` + `/terms` + README.
  - Keywords: 100 char, comma-separated, no spaces wasted
    ("tree,arborist,crm,lead,field,route,sales,invoice,schedule,estimate").
  - Support URL: `https://lead-intake-sooty.vercel.app` (until a
    dedicated help page exists).
  - Marketing URL: same.

## 7. App Privacy labels (☁️)

Apple requires declaring every category of data you collect and how
it's used. Based on the current code 🤖 audited these for you:

| Data type | Collected? | Linked to user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Name | Yes | Yes | No | App Functionality (workspace + lead owner) |
| Email | Yes | Yes | No | Account, App Functionality |
| Phone number | Yes | Yes | No | App Functionality (customer contact) |
| Physical address | Yes | Yes | No | App Functionality (route planning) |
| Precise location | Yes | No | No | App Functionality (route start position only, not stored) |
| Coarse location | No | — | — | — |
| Photos | Yes | Yes | No | App Functionality (screenshot ingest, lead photos) |
| Crash data | No | — | — | — (not currently instrumented; add Sentry later) |
| Performance data | No | — | — | — |
| Other diagnostic data | No | — | — | — |
| Purchases | Yes | Yes | No | App Functionality (Stripe — but declared because workspace plan state is shown in-app) |
| Product interaction | Yes | Yes | No | App Functionality (upload counts, route history) |
| Advertising data | No | — | — | — |

"Tracking" in Apple's sense means sharing data with third parties for
advertising — we don't, so every row is "No" in the tracking column.

## 8. Reviewer test account (☁️ + 🤖 seeding help)

Apple rejects anything with a login wall unless you give them a working
credential. Required fields:

- Username: `appreview@leadflow.app` (or similar dedicated address —
  don't use your personal account).
- Password: a strong password **you put in 1Password now and don't
  rotate until the app is approved**.
- Notes for App Review: Paste something like:

> This is a B2B CRM for tree and service contractors. The test account
> is already logged into the "App Review Demo" workspace with 5 sample
> leads and 2 scheduled route stops. Swipe up on the Leads tab to see
> more. No sign-up is required for the reviewer.
>
> Billing management is intentionally web-only (Guideline 3.1.3(b)
> business-services exemption — this is a multi-user B2B tool where
> seats are provisioned by the workspace admin via the web
> dashboard). The app does not present any in-app purchase or
> subscription management UI.
>
> Push notifications are opt-in from the Notifications setting card.

🤖 can seed the demo workspace with a migration that runs against
production Supabase once you give me the account email — that way
the seeded data is deterministic and can't be nuked accidentally.

## 9. Build + TestFlight (🧑‍💻, Xcode)

When all the above is done:

```bash
npx cap sync ios
npx cap open ios        # opens App.xcworkspace in Xcode
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities** → tick
   "Automatically manage signing" → pick your team.
2. Add the **Push Notifications** capability (+ button).
3. Set the bundle identifier to `com.arborcore.leadflow` (should already be
   set from `capacitor.config.ts`).
4. Set version to `1.0.0` and build number to `1`.
5. **Product → Archive** (requires "Any iOS Device" selected as the
   run destination, not a simulator).
6. When the Organizer pops open, click **Distribute App → App Store
   Connect → Upload**. First upload takes ~10 min.
7. In App Store Connect → TestFlight → iOS builds — your build appears
   after processing (~15–30 min). Add it to an internal testing
   group (no App Review needed for internal testers, up to 100
   people).
8. Install TestFlight on your iPhone, open the invite link, smoke
   test:
   - Sign in to the reviewer account.
   - Create a lead via screenshot upload → confirm it appears.
   - Tap `/billing` → confirm you see `WebManagedBillingNote` and
     **not** `PlanCompareCard` or `ManageBillingButton`.
   - Enable notifications → confirm the pre-prompt dialog, then the
     native permission prompt.
   - Toggle airplane mode → confirm the offline banner.

## 10. Submit for review (☁️)

When TestFlight smoke passes:

1. App Store Connect → your app → **+ Version** → 1.0.
2. Select the TestFlight build as the binary for this version.
3. Fill in screenshots (required: 6.7" iPhone + 5.5" iPhone at
   minimum, per Apple's current rules — iPad screenshots only if you
   claim iPad support; leave that off v1).
4. Fill in "App Review Information" with the reviewer credentials from
   step 8.
5. Submit. Review times are typically 24–48h; first submissions
   sometimes take longer.

## 11. Post-approval hardening (future work)

- **Universal Links** — `apple-app-site-association` at
  `https://lead-intake-sooty.vercel.app/.well-known/apple-app-site-association`
  + `Associated Domains` entitlement. Makes tapping a lead URL in
  Messages open the app instead of Safari.
- **Sentry / crash reporting** — Capacitor-compatible plugin exists.
  Update the App Privacy labels when you add it.
- **Haptics on save** — `@capacitor/haptics` is already installed; just
  needs a one-line `Haptics.impact()` call after lead save.
- **Native share sheet** — `@capacitor/share` for "text this lead's
  address" flows.

---

## Failure modes seen in the wild

- **"Missing Push Notification entitlement"** during Archive — you
  forgot to add the capability in Xcode (step 9.2).
- **"Invalid Swift Support"** on upload — you built with a different
  Xcode than is currently installed on the build machine; re-archive
  with the latest.
- **"App Tracking Transparency" rejection** — you didn't add
  `NSUserTrackingUsageDescription`. If LeadFlow doesn't use IDFA for
  tracking (it doesn't), just don't import `AppTrackingTransparency`
  and don't add the key — Apple won't flag it. Only add the key if you
  ever integrate an ad SDK.
- **"Guideline 4.2 — Minimum Functionality"** — this is the
  "repackaged website" rejection. The push + camera + photo library +
  location integrations we add above are specifically to pre-empt
  this. If Review still pushes back, respond in App Review Contact
  pointing at the four native integrations and the 3.1.3(b)
  exemption.
