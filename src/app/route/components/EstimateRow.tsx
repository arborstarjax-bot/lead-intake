"use client";

import Link from "next/link";
import {
  ChevronRight,
  MessageSquare,
  Navigation,
  Phone,
  User,
} from "lucide-react";
import { formatClock, type Stop } from "../route-helpers";

export function EstimateRow({ stop, index }: { stop: Stop; index: number }) {
  const telHref = stop.phoneNumber
    ? `tel:${stop.phoneNumber.replace(/[^\d+]/g, "")}`
    : null;
  const smsHref = stop.phoneNumber
    ? `sms:${stop.phoneNumber.replace(/[^\d+]/g, "")}`
    : null;
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    stop.address
  )}`;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-12 text-right">
          <div className="text-sm font-semibold text-[var(--fg)] tabular-nums">
            {formatClock(stop.startTime)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            #{index}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/leads?lead=${stop.id}`}
            className="block min-w-0 group"
          >
            <div className="font-medium truncate group-hover:underline">
              {stop.label}
            </div>
            <div className="text-xs text-[var(--muted)] truncate">
              {stop.address}
            </div>
          </Link>
          {(stop.salesPerson || stop.phoneNumber) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {stop.salesPerson ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 h-5 text-[11px] text-[var(--fg)]">
                  <User className="h-3 w-3" /> {stop.salesPerson}
                </span>
              ) : null}
              {stop.phoneNumber ? (
                <a
                  href={telHref ?? undefined}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 h-5 text-[11px] text-[var(--fg)] hover:bg-slate-200"
                >
                  <Phone className="h-3 w-3" /> {stop.phoneNumber}
                </a>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {telHref && (
            <a
              href={telHref}
              aria-label={`Call ${stop.label}`}
              className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
          {smsHref && (
            <a
              href={smsHref}
              aria-label={`Text ${stop.label}`}
              className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
            >
              <MessageSquare className="h-4 w-4" />
            </a>
          )}
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`Navigate to ${stop.address}`}
            className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <Navigation className="h-4 w-4" />
          </a>
          <Link
            href={`/leads?lead=${stop.id}`}
            aria-label={`Open ${stop.label}`}
            className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </li>
  );
}
