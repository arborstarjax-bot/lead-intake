import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-[var(--muted)]">
            Sign in to your workspace
          </p>
        </div>
        <LoginForm next={sp.next} initialError={sp.error} />
        <p className="text-sm text-center text-[var(--muted)]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[var(--accent)] font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
