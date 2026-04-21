import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { stripe, priceIds } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  plan: "starter" | "pro";
};

function baseUrl(req: NextRequest): string {
  // Prefer the explicit env so previews + prod don't redirect to each
  // other, but fall back to the request host in case env is missing.
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || (body.plan !== "starter" && body.plan !== "pro")) {
    return NextResponse.json({ error: "invalid plan" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: workspace, error: wErr } = await admin
    .from("workspaces")
    .select("id, name, stripe_customer_id")
    .eq("id", auth.workspaceId)
    .maybeSingle();
  if (wErr || !workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  // Seat count: every member (admin + user) is a paid seat.
  const { count: seatCount } = await admin
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id);
  const seats = Math.max(1, seatCount ?? 1);

  const ids = priceIds();
  const tierIds = ids[body.plan];
  // Base = 1 seat included. Seat addon covers (seats - 1).
  const extraSeats = Math.max(0, seats - 1);

  const lineItems: Array<{ price: string; quantity: number }> = [
    { price: tierIds.base, quantity: 1 },
  ];
  if (extraSeats > 0) {
    lineItems.push({ price: tierIds.seat, quantity: extraSeats });
  }

  const appUrl = baseUrl(req);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: lineItems,
    // 14-day trial on first subscription only. Stripe ignores this on
    // a returning customer, which is exactly the behavior we want.
    subscription_data: {
      trial_period_days: 14,
      metadata: { workspace_id: workspace.id },
    },
    customer: workspace.stripe_customer_id ?? undefined,
    customer_creation: workspace.stripe_customer_id ? undefined : "always",
    client_reference_id: workspace.id,
    metadata: { workspace_id: workspace.id, plan: body.plan },
    success_url: `${appUrl}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/billing?status=canceled`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "stripe did not return checkout url" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: session.url });
}
