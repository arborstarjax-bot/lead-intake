export const TASK_STATUSES = [
  "Scheduled",
  "Completed",
  "Rescheduled",
  "Cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

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
];
