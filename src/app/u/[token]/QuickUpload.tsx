"use client";

import UploadBox from "@/components/UploadBox";

export default function QuickUpload({ token }: { token: string }) {
  return (
    <main className="min-h-dvh p-4 sm:p-8 max-w-md mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Send a lead</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Pick a screenshot (or photo of one) from your phone. It goes straight
          to the leads table — no login, no app needed. Bookmark this page on
          your iPhone home screen for one-tap access.
        </p>
      </div>
      <UploadBox endpoint={`/api/quick-upload/${token}`} />
      <p className="text-xs text-[var(--muted)]">
        Keep this link private. Anyone with it can upload screenshots.
      </p>
    </main>
  );
}
