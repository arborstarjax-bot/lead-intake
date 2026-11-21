"use client";

import { useEffect, useState } from "react";
import { BookOpen, Copy, Trash2, Webhook } from "lucide-react";
import { Panel } from "./Panel";
import { useToast } from "@/components/Toast";
import { ALL_SCOPES } from "@/modules/api/v1/scopes";

type ApiKeyRow = {
  id: string; name: string; prefix: string; scopes: string[];
  createdAt: string; lastUsedAt: string | null; revoked: boolean;
};
type WebhookRow = { id: string; url: string; events: string[]; isActive: boolean };

const ALL_EVENTS = [
  "lead.created", "lead.updated", "lead.sold", "lead.lost",
  "task.created", "task.completed",
];

export function ApiPlatformPanel() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [hooks, setHooks] = useState<WebhookRow[] | null>(null);
  const [newKey, setNewKey] = useState<{ id: string; key: string } | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [k, w] = await Promise.all([
      fetch("/api/v1/keys").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/v1/webhooks").then((r) => (r.ok ? r.json() : null)),
    ]);
    setKeys(k?.data ?? []);
    setHooks(w?.data ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: keyName || "Default key", scopes: ALL_SCOPES }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) { toast({ message: j?.error?.message ?? "Failed to create key", kind: "error" }); return; }
    setNewKey({ id: j.data.id, key: j.data.key });
    setKeyName("");
    void load();
  }

  async function revokeKey(id: string) {
    await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    void load();
  }

  async function createHook(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: hookUrl, events: ALL_EVENTS }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) { toast({ message: j?.error?.message ?? "Failed to add webhook", kind: "error" }); return; }
    setNewSecret(j.data.secret);
    setHookUrl("");
    void load();
  }

  async function deleteHook(id: string) {
    await fetch(`/api/v1/webhooks/${id}`, { method: "DELETE" });
    void load();
  }

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(() => toast({ message: `${what} copied`, kind: "success" }));
  }

  return (
    <Panel
      title="API & Webhooks"
      description="Connect LeadFlow to Jobber, ServiceTitan, Housecall Pro, HubSpot, Zapier, or your own systems."
    >
      <div className="space-y-4">
        <a
          href="/api-docs"
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--accent)] text-[var(--accent)] px-3 h-9 text-xs font-medium hover:bg-emerald-50"
        >
          <BookOpen className="h-4 w-4" />
          Open API reference
        </a>

        {newKey && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-1.5">
            <div className="font-semibold">API key created — copy it now. It won&apos;t be shown again.</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all font-mono bg-white rounded px-2 py-1">{newKey.key}</code>
              <button onClick={() => copy(newKey.key, "API key")} className="shrink-0 text-[var(--accent)]"><Copy className="h-4 w-4" /></button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">API keys</div>
          {(keys ?? []).map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{k.name} <code className="text-xs text-[var(--muted)]">{k.prefix}…</code></div>
                <div className="text-[11px] text-[var(--muted)]">
                  {k.revoked ? "Revoked" : `Created ${new Date(k.createdAt).toLocaleDateString()}${k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ""}`}
                </div>
              </div>
              {!k.revoked && (
                <button onClick={() => revokeKey(k.id)} className="text-rose-600 hover:text-rose-700" aria-label="Revoke key">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {keys && keys.length === 0 && <div className="text-xs text-[var(--muted)]">No keys yet.</div>}
          <form onSubmit={createKey} className="flex gap-2">
            <input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="Key name (e.g. Zapier)"
              className="flex-1 h-9 rounded-lg border border-[var(--border)] px-3 text-sm"
            />
            <button disabled={busy} className="h-9 rounded-lg bg-[var(--accent)] text-white px-3 text-xs font-semibold disabled:opacity-50">
              Create key
            </button>
          </form>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
            <Webhook className="h-3.5 w-3.5" /> Webhook subscriptions
          </div>
          {newSecret && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-1.5">
              <div className="font-semibold">Signing secret — copy now. Verify the x-leadflow-signature header with it.</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all font-mono bg-white rounded px-2 py-1">{newSecret}</code>
                <button onClick={() => copy(newSecret, "Secret")} className="shrink-0 text-[var(--accent)]"><Copy className="h-4 w-4" /></button>
              </div>
            </div>
          )}
          {(hooks ?? []).map((h) => (
            <div key={h.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs truncate">{h.url}</div>
                <div className="text-[11px] text-[var(--muted)]">{h.events.join(", ")}</div>
              </div>
              <button onClick={() => deleteHook(h.id)} className="text-rose-600 hover:text-rose-700" aria-label="Delete webhook">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {hooks && hooks.length === 0 && <div className="text-xs text-[var(--muted)]">No subscriptions yet.</div>}
          <form onSubmit={createHook} className="flex gap-2">
            <input
              value={hookUrl}
              onChange={(e) => setHookUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/…"
              type="url"
              required
              className="flex-1 h-9 rounded-lg border border-[var(--border)] px-3 text-sm"
            />
            <button disabled={busy} className="h-9 rounded-lg bg-[var(--accent)] text-white px-3 text-xs font-semibold disabled:opacity-50">
              Add webhook
            </button>
          </form>
          <p className="text-[11px] text-[var(--muted)]">New subscriptions receive all events; manage event sets via PATCH /api/v1/webhooks/:id.</p>
        </div>
      </div>
    </Panel>
  );
}
