export const TASK_STATUSES = [
  "Scheduled",
  "Completed",
  "Rescheduled",
  "Cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RECURRENCE_OPTIONS = [
  { value: "", label: "None (one-time)" },
  { value: "daily_weekdays", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Every week" },
  { value: "weekly:monday", label: "Every Monday" },
  { value: "weekly:tuesday", label: "Every Tuesday" },
  { value: "weekly:wednesday", label: "Every Wednesday" },
  { value: "weekly:thursday", label: "Every Thursday" },
  { value: "weekly:friday", label: "Every Friday" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
] as const;

export type RecurrenceRule = (typeof RECURRENCE_OPTIONS)[number]["value"];

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  Scheduled: "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  Rescheduled: "bg-orange-100 text-orange-800",
  Cancelled: "bg-gray-100 text-gray-800",
};

export type Task = {
  id: string;
  workspace_id: string;
  name: string;
  notes: string | null;
  status: TaskStatus;
  start_at: string;
  end_at: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  assignee: string | null;
  created_by: string | null;
  file_url: string | null;
  file_path: string | null;
  extraction_source: "manual" | "upload_extract" | null;
  extraction_confidence: Record<string, number> | null;
  screenshot_url: string | null;
  screenshot_path: string | null;
  singleops_task_id: string | null;
  singleops_sync_status: "idle" | "pending" | "synced" | "failed";
  singleops_sync_error: string | null;
  singleops_last_synced_at: string | null;
  recurrence_rule: string | null;
  recurrence_end_date: string | null;
  recurrence_end_count: number | null;
  parent_task_id: string | null;
  occurrence_index: number | null;
  created_at: string;
  updated_at: string;
};

export type TaskPatch = Partial<
  Pick<
    Task,
    | "name"
    | "notes"
    | "status"
    | "start_at"
    | "end_at"
    | "address"
    | "city"
    | "state"
    | "zip"
    | "assignee"
    | "file_url"
    | "file_path"
    | "recurrence_rule"
    | "recurrence_end_date"
    | "recurrence_end_count"
  >
>;

export const TASK_EDITABLE_COLUMNS: (keyof Task)[] = [
  "name",
  "notes",
  "status",
  "start_at",
  "end_at",
  "address",
  "city",
  "state",
  "zip",
  "assignee",
  "file_url",
  "file_path",
  "recurrence_rule",
  "recurrence_end_date",
  "recurrence_end_count",
];

/**
 * Compute the next occurrence date from a recurrence rule.
 * Returns null if the rule is unknown or there is no next date.
 */
export function nextOccurrenceDate(current: Date, rule: string): Date | null {
  const d = new Date(current);
  switch (rule) {
    case "daily_weekdays": {
      d.setDate(d.getDate() + 1);
      // Skip weekends
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      return d;
    }
    case "weekly":
      d.setDate(d.getDate() + 7);
      return d;
    case "weekly:monday":
    case "weekly:tuesday":
    case "weekly:wednesday":
    case "weekly:thursday":
    case "weekly:friday": {
      const dayMap: Record<string, number> = {
        "weekly:monday": 1,
        "weekly:tuesday": 2,
        "weekly:wednesday": 3,
        "weekly:thursday": 4,
        "weekly:friday": 5,
      };
      const target = dayMap[rule];
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== target) d.setDate(d.getDate() + 1);
      return d;
    }
    case "biweekly":
      d.setDate(d.getDate() + 14);
      return d;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      return d;
    default:
      return null;
  }
}
