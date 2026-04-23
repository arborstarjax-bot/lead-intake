import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { SettingsProvider } from "@/components/SettingsProvider";
import { BottomNav } from "@/components/BottomNav";
import { OfflineQueueReplayer } from "@/modules/offline";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LeadFlow",
  description: "Upload screenshots, extract leads, call/text/email, schedule.",
  // iOS Safari in standalone (PWA) mode defaults to a strict referrer policy
  // that sends no Referer header on cross-origin requests. That causes the
  // Google Maps JS key's HTTP-referrer restriction to reject the load — which
  // looks like a broken map only on iPhone. Forcing `origin` guarantees the
  // request always carries the site origin so the key check passes.
  referrer: "origin",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "LeadFlow",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f3d26",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <ToastProvider>
          <ConfirmProvider>
            <SettingsProvider>
              {children}
              <BottomNav />
              <OfflineQueueReplayer />
            </SettingsProvider>
          </ConfirmProvider>
        </ToastProvider>
        {/* Register service worker on client. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function(){});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
