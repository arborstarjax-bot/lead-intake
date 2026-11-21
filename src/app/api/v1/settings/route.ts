import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveApiAuth, requireScope, ok, badRequest, handlerResult, serverError, toCamel,
} from "@/modules/api/v1";
import { getSettings, type AppSettings } from "@/lib/settings";
import { applySettingsPatch, settingsPatchSchema } from "@/modules/settings/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsContract(s: AppSettings) {
  return {
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
  };
}

export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "settings:read");
  if (scopeErr) return scopeErr;

  try {
    return ok(settingsContract(await getSettings(auth.workspaceId)));
  } catch (e) {
    return serverError((e as Error).message);
  }
}

/** camelCase public field → snake_case column name. */
const CAMEL_TO_SNAKE: Record<string, string> = {
  setupCompleted: "setup_completed",
  homeAddress: "home_address", homeCity: "home_city", homeState: "home_state", homeZip: "home_zip",
  workStartTime: "work_start_time", workEndTime: "work_end_time", workDays: "work_days",
  defaultJobMinutes: "default_job_minutes", travelBufferMinutes: "travel_buffer_minutes",
  minTimeBetweenAppointments: "min_time_between_appointments",
  daysUntilLost: "days_until_lost", daysUntilNotSold: "days_until_not_sold",
  companyName: "company_name", companyPhone: "company_phone", companyEmail: "company_email",
  businessType: "business_type", salespersonTitles: "salesperson_titles",
  defaultSalesperson: "default_salesperson", leadSources: "lead_sources",
  smsIntroTemplate: "sms_intro_template", smsConfirmTemplate: "sms_confirm_template",
  smsEnrouteTemplate: "sms_enroute_template",
  emailSubjectTemplate: "email_subject_template", emailBodyTemplate: "email_body_template",
};

function camelBodyToSnake(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    out[CAMEL_TO_SNAKE[k] ?? k] = v;
  }
  return out;
}

/** PATCH /api/v1/settings — update workspace settings (same fields as the app).
 *  Accepts the camelCase contract names (workStartTime, leadSources, …);
 *  snake_case keys are passed through unchanged. */
export async function PATCH(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "settings:write");
  if (scopeErr) return scopeErr;

  let parsed;
  try {
    parsed = settingsPatchSchema.parse(camelBodyToSnake(await req.json()));
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "invalid body";
    return badRequest(msg);
  }

  const res = await applySettingsPatch(auth.workspaceId, auth.role, parsed);
  if (res.status >= 400) return handlerResult(res);
  return ok(settingsContract(res.settings!));
}
