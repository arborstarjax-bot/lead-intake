/**
 * SMS / email template helpers shared by server and client code.
 *
 * The single-row `app_settings` table stores user-customizable copy for
 * the first-touch SMS, the confirmation SMS after booking, and the intro
 * email. When a field is null, the default string lives here so we can
 * render consistent copy even before the user has touched Settings.
 *
 * Placeholders are `{name}` style — deliberately simple so the textareas
 * in Settings stay copy-pasteable and there's no escaping to reason about.
 * Any placeholder that isn't in `vars` renders as the literal `{name}`,
 * which makes missing data visible instead of producing "Hi , …".
 */

export const TEMPLATE_PLACEHOLDERS = [
  "firstName",
  "lastName",
  "client",
  "day",
  "time",
  "salesPerson",
  "companyName",
  "companyPhone",
  "companyEmail",
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export type TemplateVars = Partial<Record<TemplatePlaceholder, string | null | undefined>>;

// These live in module scope so both server and client can import them.
// Keep in sync with `/settings` placeholder hint text.
export const DEFAULT_SMS_INTRO =
  "Hi {firstName}, this is {salesPerson} with {companyName}. I'm reaching " +
  "out regarding your request for a free estimate/arborist assessment. " +
  "Feel free to call or text me to schedule a day and time that works " +
  "best for you. I look forward to helping you out!";

export const DEFAULT_SMS_CONFIRM =
  "Hi {firstName}, {salesPerson} with {companyName}. Confirming our " +
  "arborist assessment on {day} at {time}. Reply here if anything " +
  "changes — see you then!";

export const DEFAULT_EMAIL_SUBJECT =
  "Your free estimate from {companyName}";

export const DEFAULT_EMAIL_BODY =
  "Hi {firstName},\n\n" +
  "Thanks for reaching out to {companyName}. I'd love to set up a time " +
  "to swing by and take a look at the trees you have questions about. " +
  "Let me know a day and time that works for you and I'll confirm back.\n\n" +
  "— {salesPerson}\n" +
  "{companyPhone}";

/**
 * Replace `{placeholder}` occurrences with values from `vars`. Missing
 * values leave the literal `{placeholder}` in the output so blank fields
 * are visible during editing instead of silently collapsing to "Hi , …".
 */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  return tpl.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = vars[key as TemplatePlaceholder];
    if (v === undefined || v === null) return m;
    const trimmed = String(v).trim();
    return trimmed || m;
  });
}

/**
 * Resolve each configured template against its built-in default. Kept here
 * (rather than in settings.ts) so client code can call it without dragging
 * in `server-only` imports.
 */
type TemplateSource = {
  sms_intro_template?: string | null;
  sms_confirm_template?: string | null;
  email_subject_template?: string | null;
  email_body_template?: string | null;
};

export function smsIntroTemplate(s: TemplateSource): string {
  return s.sms_intro_template?.trim() || DEFAULT_SMS_INTRO;
}
export function smsConfirmTemplate(s: TemplateSource): string {
  return s.sms_confirm_template?.trim() || DEFAULT_SMS_CONFIRM;
}
export function emailSubjectTemplate(s: TemplateSource): string {
  return s.email_subject_template?.trim() || DEFAULT_EMAIL_SUBJECT;
}
export function emailBodyTemplate(s: TemplateSource): string {
  return s.email_body_template?.trim() || DEFAULT_EMAIL_BODY;
}
