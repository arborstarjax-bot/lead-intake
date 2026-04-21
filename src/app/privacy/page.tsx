/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · LeadFlow",
};

const LAST_UPDATED = "April 21, 2026";

/**
 * Plain-language privacy policy covering Apple App Store, Google Play,
 * and GDPR/CCPA baseline requirements. Any service-specific details
 * (company legal name, postal address, DPO email) need to be filled in
 * before submitting to the stores.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-[var(--bg)] py-10 px-4">
      <article className="mx-auto max-w-2xl space-y-5 rounded-2xl bg-white border border-[var(--border)] p-6 sm:p-8 text-[15px] leading-relaxed">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Privacy Policy</h1>
          <p className="text-xs text-[var(--muted)]">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <p>
          LeadFlow ("we", "us", "our") provides a mobile-first tool that
          lets field service teams capture, organize, route, and follow up
          with sales leads. This policy explains what we collect, how we
          use it, and how to control or delete it.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">1. Data we collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Account data</strong> — email address, password hash,
              and the workspace you belong to.
            </li>
            <li>
              <strong>Lead content you provide</strong> — screenshots you
              upload, plus the names, phone numbers, email addresses,
              street addresses, and notes extracted from them.
            </li>
            <li>
              <strong>Calendar connection data</strong> — if you connect
              Google Calendar, we store an OAuth refresh token and create
              events on the calendar you authorize.
            </li>
            <li>
              <strong>Push notification data</strong> — if you enable push,
              we store the endpoint and keys your browser/device issues.
            </li>
            <li>
              <strong>Minimal telemetry</strong> — request logs (IP,
              timestamp, path, status) retained by our hosting provider for
              security and operations.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> collect advertising identifiers,
            sell personal data, or share data with third-party advertisers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">
            2. How we use your data
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Run the product features you explicitly trigger.</li>
            <li>
              Send uploaded screenshots to OpenAI's GPT-4o for text
              extraction, returning only structured lead fields.
            </li>
            <li>
              Insert/update events on the Google Calendar you connected.
            </li>
            <li>Send push notifications you opted into.</li>
            <li>Prevent abuse (rate limiting, fraud detection).</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">
            3. Subprocessors we rely on
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Supabase</strong> — database, authentication, storage
            </li>
            <li>
              <strong>Vercel</strong> — web hosting
            </li>
            <li>
              <strong>OpenAI</strong> — vision-based extraction from
              uploaded screenshots
            </li>
            <li>
              <strong>Google</strong> — optional Calendar integration
            </li>
            <li>
              <strong>Apple / Google</strong> — push notification delivery
              (when enabled)
            </li>
            <li>
              <strong>Stripe / Apple / Google</strong> — subscription
              payments
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">4. Data retention</h2>
          <p>
            Lead content is retained as long as you keep it in your
            workspace. Deleting a lead removes both the database row and
            its stored screenshot. Deleting your account deletes your
            profile and your membership; if you were the sole member of a
            workspace, the workspace and everything in it is also deleted.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">
            5. Your rights — access, export, deletion
          </h2>
          <p>
            You can delete your account at any time from{" "}
            <Link href="/workspace" className="text-[var(--accent)] underline">
              /workspace
            </Link>{" "}
            → <em>Delete account</em>. To request a data export or to
            exercise any other GDPR/CCPA right, email us at the address in
            Section 8. We respond within 30 days.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">6. Children</h2>
          <p>
            LeadFlow is a business tool and is not directed at children
            under 13. We do not knowingly collect data from children.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">7. Security</h2>
          <p>
            All traffic uses TLS. Passwords are hashed. Screenshots are
            stored in a private bucket and served only to signed-in members
            of the owning workspace. No system is perfectly secure — if you
            discover a vulnerability, please contact us privately before
            disclosing.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">8. Contact</h2>
          <p>
            Questions, deletion requests, or data subject requests:{" "}
            <a
              href="mailto:privacy@leadflow.app"
              className="text-[var(--accent)] underline"
            >
              privacy@leadflow.app
            </a>
            .
          </p>
        </section>

        <footer className="pt-4 text-xs text-[var(--muted)]">
          This document may change as the product evolves. Material
          changes will be announced in-app or by email at least 14 days
          before taking effect.
        </footer>
      </article>
    </main>
  );
}
