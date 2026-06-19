import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { PageHeader } from "@/components/PageHeader";
import type { Task } from "@/modules/tasks/model";
import { TaskDetailCard } from "./TaskDetailCard";

export default async function TaskViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireMembership();
  if (auth instanceof Response) {
    redirect(`/login?next=${encodeURIComponent(`/tasks/${id}`)}`);
  }

  const supabase = createAdminClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (!task) notFound();

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-4 space-y-4">
      <PageHeader title="Task" />
      <div className="flex items-center gap-2">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tasks
        </Link>
      </div>
      <TaskDetailCard initialTask={task as Task} />
    </div>
  );
}
