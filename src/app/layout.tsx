import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Intake",
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
    title: "Lead Intake",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#111827",
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
    <html lang="en">
      <body>
        {children}
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
