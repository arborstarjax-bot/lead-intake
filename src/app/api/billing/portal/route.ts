import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/modules/shared/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  return `${proto}://${host}`;
}

/**
 * Open a Stripe Billing Portal session so the user can update their
 * card, view invoices, or cancel. We only generate the short-lived URL;
 * all state changes flow back to us via the existing webhook handler.
 *
 * Requires the Billing Portal to be configured in the Stripe dashboard
 * first (Settings → Billing → Customer portal → Activate).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const admin = createAdminClient();
  const { data: workspace, error } = await admin
    .from("workspaces")
    .select("stripe_customer_id")
    .eq("id", auth.workspaceId)
    .maybeSingle();
  if (error || !workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }
  if (!workspace.stripe_customer_id) {
    // No customer means they've never started a checkout — nothing to
    // manage. Send them through the normal upgrade flow instead.
    return NextResponse.json(
      {
        error:
          "No billing profile yet. Start a plan from /billing to create one.",
      },
      { status: 400 }
    );
  }

  const appUrl = baseUrl(req);

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: workspace.stripe_customer_id,
      return_url: `${appUrl}/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] stripe.billingPortal.sessions.create failed", err);
    const message = err instanceof Error ? err.message : "unknown stripe error";
    return NextResponse.json(
      { error: "could not open billing portal", detail: message },
      { status: 500 }
    );
  }
}
