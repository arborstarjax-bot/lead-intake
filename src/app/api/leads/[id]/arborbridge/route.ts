import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

/**
 * POST /api/leads/[id]/arborbridge
 * Push a lead to ArborBridge.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  // Fetch the lead
  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();

  if (error || !lead) {
    return NextResponse.json(
      { error: "Lead not found" },
      { status: 404 }
    );
  }

  // Build the ArborBridge payload
  const payload = {
    lead: {
      leadId: lead.id,
      leadStatus: lead.status,
      leadSource: lead.lead_source,
      requestSummary: lead.notes,
      notes: lead.notes,
      createdAt: lead.created_at,
      updatedAt: lead.updated_at,
    },
    client: {
      fullName: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.client,
      companyName: lead.client,
      phone: lead.phone_number,
      email: lead.email,
    },
    property: {
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
    },
    estimate: {
      scheduledStart: buildScheduledStart(lead.scheduled_day, lead.scheduled_time),
      timezone: "America/Chicago",
    },
    assignment: {
      assignedEstimator: lead.sales_person,
    },
    links: {
      leadFlowUrl: `${process.env.NEXT_PUBLIC_APP_URL || ""}/leads?highlight=${lead.id}`,
    },
  };

  // Send to ArborBridge
  const arborbridgeUrl = process.env.ARBORBRIDGE_URL;
  const arborbridgeApiKey = process.env.ARBORBRIDGE_API_KEY;

  if (!arborbridgeUrl || !arborbridgeApiKey) {
    return NextResponse.json(
      { error: "ArborBridge not configured. Set ARBORBRIDGE_URL and ARBORBRIDGE_API_KEY." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${arborbridgeUrl}/api/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": arborbridgeApiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      // Mark as failed
      await supabase
        .from("leads")
        .update({
          arborbridge_status: "push_failed",
          arborbridge_last_pushed_at: new Date().toISOString(),
        })
        .eq("id", id);

      return NextResponse.json(
        { error: data.error || "Failed to push to ArborBridge", status: "push_failed" },
        { status: 502 }
      );
    }

    // Mark as pushed
    await supabase
      .from("leads")
      .update({
        arborbridge_status: "pushed_to_arborbridge",
        arborbridge_record_id: data.recordId,
        arborbridge_last_pushed_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({
      success: true,
      recordId: data.recordId,
      status: "pushed_to_arborbridge",
    });
  } catch (err) {
    // Mark as failed
    await supabase
      .from("leads")
      .update({
        arborbridge_status: "push_failed",
        arborbridge_last_pushed_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json(
      { error: "Network error connecting to ArborBridge", status: "push_failed" },
      { status: 502 }
    );
  }
}

function buildScheduledStart(day: string | null, time: string | null): string | null {
  if (!day) return null;
  if (!time) return `${day}T09:00:00`;
  return `${day}T${time}`;
}
