import { notFound } from "next/navigation";
import QuickUpload from "./QuickUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QuickUploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const expected = process.env.LEAD_INTAKE_UPLOAD_TOKEN ?? "";
  if (!expected || token !== expected) notFound();

  return <QuickUpload token={token} />;
}
