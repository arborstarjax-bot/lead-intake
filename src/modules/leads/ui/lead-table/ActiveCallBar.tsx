"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Headphones } from "lucide-react";

interface ActiveCall {
  id: string;
  lead_id: string;
  lead_name: string;
  status: "queued" | "ringing" | "in_progress";
  started_at: string;
  listen_url: string | null;
}

/**
 * Decode mu-law byte to 16-bit linear PCM sample.
 * Standard ITU-T G.711 mu-law expansion table.
 */
function mulawDecode(mulaw: number): number {
  mulaw = ~mulaw & 0xff;
  const sign = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;
  let sample = ((mantissa << 1) + 33) << (exponent + 2);
  sample -= 0x84;
  return sign ? -sample : sample;
}

/**
 * Shows a slim status bar at the top of the leads page when a single AI call
 * is in progress (not part of a campaign — campaigns have their own bar).
 */
export function ActiveCallBar() {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [listening, setListening] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  const fetchActive = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/active");
      if (res.ok) {
        const json = await res.json();
        setCall(json.active ?? null);
      }
    } catch {
      // Silently ignore
    }
  }, []);

  // Poll for active call every 2 seconds
  useEffect(() => {
    fetchActive();
    const interval = setInterval(fetchActive, 2000);
    return () => clearInterval(interval);
  }, [fetchActive]);

  // Tick the elapsed timer every second while a call is active
  useEffect(() => {
    if (!call) {
      setElapsed(0);
      return;
    }
    const start = new Date(call.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [call]);

  // Clean up WebSocket + AudioContext when call ends or component unmounts
  useEffect(() => {
    if (!call) {
      stopListening();
    }
    return () => stopListening();
  }, [call]);

  function stopListening() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    setListening(false);
  }

  function startListening() {
    if (!call?.listen_url) return;

    const audioCtx = new AudioContext({ sampleRate: 8000 });
    audioCtxRef.current = audioCtx;
    nextPlayTimeRef.current = audioCtx.currentTime;

    const ws = new WebSocket(call.listen_url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const raw = new Uint8Array(event.data);
      const pcm = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        pcm[i] = mulawDecode(raw[i]) / 32768;
      }
      const buffer = audioCtx.createBuffer(1, pcm.length, 8000);
      buffer.getChannelData(0).set(pcm);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      const playAt = Math.max(nextPlayTimeRef.current, now);
      source.start(playAt);
      nextPlayTimeRef.current = playAt + buffer.duration;
    };

    ws.onclose = () => setListening(false);
    ws.onerror = () => {
      stopListening();
    };

    setListening(true);
  }

  function toggleListen() {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }

  if (!call) return null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  const statusText =
    call.status === "queued"
      ? "Queued"
      : call.status === "ringing"
      ? "Ringing…"
      : "In progress";

  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50/70 px-4 py-2.5 shadow-sm">
      <div className="relative flex items-center justify-center">
        <Phone className="h-4 w-4 text-green-700" />
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-green-900">
            AI Calling
          </span>
          <span className="text-xs text-green-700">{statusText}</span>
          <span className="text-xs font-mono text-green-600">{timeStr}</span>
        </div>
        <div className="text-xs text-green-800 truncate">
          {call.lead_name}
        </div>
      </div>
      {call.listen_url && call.status === "in_progress" && (
        <button
          onClick={toggleListen}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            listening
              ? "bg-green-600 text-white"
              : "bg-white text-green-700 border border-green-300 hover:bg-green-100"
          }`}
        >
          <Headphones className="h-3.5 w-3.5" />
          {listening ? "Listening…" : "Listen In"}
        </button>
      )}
      {call.status === "in_progress" && !listening && (
        <div className="flex gap-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      )}
      {listening && (
        <div className="flex gap-0.5 items-center">
          <span className="h-2 w-0.5 rounded-full bg-green-500 animate-pulse" style={{ animationDelay: "0ms" }} />
          <span className="h-3 w-0.5 rounded-full bg-green-500 animate-pulse" style={{ animationDelay: "100ms" }} />
          <span className="h-4 w-0.5 rounded-full bg-green-500 animate-pulse" style={{ animationDelay: "200ms" }} />
          <span className="h-3 w-0.5 rounded-full bg-green-500 animate-pulse" style={{ animationDelay: "300ms" }} />
          <span className="h-2 w-0.5 rounded-full bg-green-500 animate-pulse" style={{ animationDelay: "400ms" }} />
        </div>
      )}
    </div>
  );
}
