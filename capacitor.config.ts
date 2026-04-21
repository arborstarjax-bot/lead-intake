import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the hosted LeadFlow web app in a native iOS / Android
 * shell. We don't bundle the Next.js build inside the app — the webview
 * loads the production Vercel URL directly. This keeps the app thin
 * (Apple / Google won't flag it because we add native plugins for
 * push, in-app-purchase, haptics, etc.) and means every web deploy
 * ships to mobile without a new App Store build.
 *
 * For local development against `next dev`, set CAP_DEV_URL to your
 * LAN IP (e.g. `http://192.168.1.42:3000`) and use `npx cap run ios`.
 */
const WEB_URL =
  process.env.CAP_DEV_URL ?? "https://lead-intake-sooty.vercel.app";

const config: CapacitorConfig = {
  appId: "com.leadflow.app",
  appName: "LeadFlow",
  webDir: "out",
  server: {
    url: WEB_URL,
    // Needed for `next dev` over plain HTTP on LAN IPs; harmless in
    // production because WEB_URL is https.
    cleartext: WEB_URL.startsWith("http://"),
  },
  ios: {
    // Use the brand green so the splash / status bar match the PWA.
    backgroundColor: "#166534",
    contentInset: "always",
  },
  android: {
    backgroundColor: "#166534",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
