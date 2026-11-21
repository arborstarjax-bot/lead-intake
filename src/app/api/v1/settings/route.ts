import { NextRequest, NextResponse } from "next/server";
import { resolveApiAuth, requireScope, ok, serverError, toCamel } from "@/modules/api/v1";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "settings:read");
  if (scopeErr) return scopeErr;

  try {
    const s = await getSettings(auth.workspaceId);
    return ok({
      setupCompleted: s.setup_completed,
      timezone: s.timezone,
      workDays: s.work_days,
      workStartTime: s.work_start_time,
      workEndTime: s.work_end_time,
      homeAddress: {
        line1: s.home_address, city: s.home_city, state: s.home_state, zip: s.home_zip,
      },
      scheduling: {
        defaultJobMinutes: s.default_job_minutes,
        travelBufferMinutes: s.travel_buffer_minutes,
        minTimeBetweenAppointments: s.min_time_between_appointments,
        daysUntilLost: s.days_until_lost,
        daysUntilNotSold: s.days_until_not_sold,
      },
      company: {
        name: s.company_name,
        phone: s.company_phone,
        email: s.company_email,
        businessType: s.business_type,
      },
      salespeople: s.salespeople,
      salespersonTitles: s.salesperson_titles,
      defaultSalesperson: s.default_salesperson,
      leadSources: s.lead_sources,
      templates: toCamel({
        sms_intro: s.sms_intro_template,
        sms_confirm: s.sms_confirm_template,
        sms_enroute: s.sms_enroute_template,
        email_subject: s.email_subject_template,
        email_body: s.email_body_template,
      }),
    });
  } catch (e) {
    return serverError((e as Error).message);
  }
}
