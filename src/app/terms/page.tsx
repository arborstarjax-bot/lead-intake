/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Terms of Service · LeadFlow",
};

const LAST_UPDATED = "April 21, 2026";

/**
 * Baseline Terms of Service. Plain-language, covers the App Store / Play
 * Store reviewer checklist (subscription disclosure, auto-renewal,
 * prohibited conduct, termination). Legal counsel should review before
 * commercial launch.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <PageHeader />
      <article className="space-y-5 rounded-2xl bg-white border border-[var(--border)] p-6 sm:p-8 text-[15px] leading-relaxed">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Terms of Service</h1>
          <p className="text-xs text-[var(--muted)]">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <p>
          These terms govern your use of LeadFlow (the "Service"). By
          creating an account or using the Service, you agree to these
          terms. If you don't agree, don't use the Service.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">1. Your account</h2>
          <p>
            You must be at least 18 and able to form a binding contract.
            You're responsible for anything done under your account; keep
            your password safe. Admins can invite and remove members of
            their workspace at any time.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">
            2. Subscriptions &amp; billing
          </h2>
          <p>
            LeadFlow is offered on a recurring subscription. Pricing, the
            billing period, and any free trial are shown to you before
            purchase. Subscriptions <strong>auto-renew</strong> at the end
            of each billing period unless cancelled at least 24 hours
            before renewal.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Web subscriptions are billed by Stripe. Manage or cancel from
              your account page.
            </li>
            <li>
              iOS subscriptions are billed by Apple through your App Store
              account. Manage from Settings → Apple ID → Subscriptions.
            </li>
            <li>
              Android subscriptions are billed by Google through Google
              Play. Manage from Play Store → Subscriptions.
            </li>
          </ul>
          <p>
            Refunds: we follow the refund policy of the billing provider
            you used (Stripe, Apple, or Google). We do not issue refunds
            for partial periods of unused service unless required by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">
            3. Acceptable use
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Don't upload content you don't have the right to share, or
              content that violates law (e.g. CSAM, stolen data).
            </li>
            <li>
              Don't use LeadFlow for unsolicited marketing, harassment, or
              anything that breaks telecom laws (TCPA in the US).
            </li>
            <li>
              Don't attempt to reverse engineer, scrape, or abuse the
              Service's rate limits.
            </li>
            <li>
              Don't use the Service to compete with us or resell it without
              written permission.
            </li>
          </ul>
          <p>
            We may suspend or terminate accounts that violate these rules.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">4. Your content</h2>
          <p>
            You own the leads, screenshots, and notes you upload. You grant
            LeadFlow a limited license to process that content solely to
            operate the Service for you (extract fields, store records,
            send calendar/push events you configure). We don't use your
            content to train AI models.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">
            5. Third-party services
          </h2>
          <p>
            LeadFlow integrates with OpenAI, Google Calendar, Stripe,
            Apple, and Google Play. Your use of those services is governed
            by their own terms. We aren't responsible for third-party
            outages, billing disputes with platform stores, or changes they
            make to their APIs.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">6. Warranty &amp; liability</h2>
          <p className="uppercase tracking-wide text-xs text-[var(--muted)]">
            Plain-English summary below — the next paragraph is the
            enforceable legal text.
          </p>
          <p>
            The Service is provided "as is" without warranty of any kind.
            To the fullest extent permitted by law, our aggregate liability
            for any claim is limited to the amount you paid us in the 12
            months before the claim arose. We're not liable for lost
            profits, lost data, or indirect damages.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">7. Termination</h2>
          <p>
            You can delete your account at any time from{" "}
            <Link href="/workspace" className="text-[var(--accent)] underline">
              /workspace
            </Link>
            . We may suspend or terminate accounts that violate these
            terms. On termination, your right to use the Service ends
            immediately; sections 2 (billing), 4 (content), 6 (liability),
            and 8 (governing law) survive.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">
            8. Governing law
          </h2>
          <p>
            These terms are governed by the laws of the State of Florida,
            USA, without regard to conflict-of-laws rules. Disputes will be
            resolved in the state or federal courts of Duval County,
            Florida.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">9. Changes</h2>
          <p>
            We'll post material changes in-app or by email at least 14 days
            before they take effect. Continuing to use the Service after
            that constitutes acceptance.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold pt-2">10. Contact</h2>
          <p>
            Questions:{" "}
            <a
              href="mailto:support@leadflow.app"
              className="text-[var(--accent)] underline"
            >
              support@leadflow.app
            </a>
            .
          </p>
        </section>
      </article>
    </main>
  );
}
