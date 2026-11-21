import { API_DOCS, WEBHOOK_EVENT_DOCS } from "@/modules/api/v1/docs";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-sky-100 text-sky-800",
  POST: "bg-emerald-100 text-emerald-800",
  PATCH: "bg-amber-100 text-amber-800",
  DELETE: "bg-rose-100 text-rose-800",
};

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 space-y-8 pb-24">
      <PageHeader title="API Reference" />

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
        <h2 className="text-base font-semibold">Getting started</h2>
        <ol className="list-decimal pl-5 text-sm text-[var(--fg)] space-y-1.5">
          <li>Create an API key in <a href="/settings" className="text-[var(--accent)] font-medium underline">Settings → API &amp; Webhooks</a>. It&apos;s shown once — store it like a password.</li>
          <li>
            Call endpoints with a Bearer header:
            <pre className="mt-1 rounded-lg bg-[var(--surface-2)] p-3 text-xs overflow-x-auto">{`curl https://lead-intake-sooty.vercel.app/api/v1/leads \\
  -H "Authorization: Bearer lf_live_…"`}</pre>
          </li>
          <li>Every response is <code className="text-xs bg-[var(--surface-2)] px-1 rounded">{"{ data }"}</code> or <code className="text-xs bg-[var(--surface-2)] px-1 rounded">{"{ error: { code, message } }"}</code>. Lists add <code className="text-xs bg-[var(--surface-2)] px-1 rounded">meta.next_cursor</code>.</li>
          <li>To sync a CRM, poll <code className="text-xs bg-[var(--surface-2)] px-1 rounded">GET /api/v1/leads?updated_since=…</code> or subscribe to webhooks below.</li>
        </ol>
      </section>

      {API_DOCS.map((group) => (
        <section key={group.name} className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">{group.name}</h2>
            <p className="text-sm text-[var(--muted)]">{group.description}</p>
          </div>
          <div className="space-y-3">
            {group.endpoints.map((e) => (
              <div key={`${e.method} ${e.path}`} className="rounded-2xl border border-[var(--border)] bg-white overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/40">
                  <span className={`inline-flex items-center justify-center min-w-[3.5rem] h-6 rounded-md text-[11px] font-bold ${METHOD_STYLES[e.method]}`}>
                    {e.method}
                  </span>
                  <code className="text-sm font-mono">{e.path}</code>
                  <span className="ml-auto text-[11px] text-[var(--muted)]">{e.scope}</span>
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <p className="text-[var(--fg)]">{e.summary}</p>
                  {e.params && e.params.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[var(--muted)]">
                          <th className="py-1 pr-3 font-medium">Param</th>
                          <th className="py-1 pr-3 font-medium">In</th>
                          <th className="py-1 pr-3 font-medium">Type</th>
                          <th className="py-1 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.params.map((p) => (
                          <tr key={p.name} className="border-t border-[var(--border)]">
                            <td className="py-1.5 pr-3 font-mono">{p.name}{p.required ? "*" : ""}</td>
                            <td className="py-1.5 pr-3">{p.in}</td>
                            <td className="py-1.5 pr-3">{p.type}</td>
                            <td className="py-1.5 text-[var(--muted)]">{p.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {e.requestExample && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Request body</div>
                      <pre className="rounded-lg bg-[var(--surface-2)] p-3 text-xs overflow-x-auto">{e.requestExample}</pre>
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Response</div>
                    <pre className="rounded-lg bg-[var(--surface-2)] p-3 text-xs overflow-x-auto">{e.responseExample}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
        <h2 className="text-base font-semibold">Webhook events</h2>
        <p className="text-sm text-[var(--muted)]">
          Payload: <code className="text-xs bg-[var(--surface-2)] px-1 rounded">{"{ id, type, createdAt, data }"}</code> —
          verify <code className="text-xs bg-[var(--surface-2)] px-1 rounded">x-leadflow-signature</code> = HMAC-SHA256(secret, body).
        </p>
        <table className="w-full text-sm">
          <tbody>
            {WEBHOOK_EVENT_DOCS.map((w) => (
              <tr key={w.event} className="border-t border-[var(--border)] first:border-0">
                <td className="py-2 pr-3 font-mono text-xs">{w.event}</td>
                <td className="py-2 text-[var(--muted)]">{w.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
