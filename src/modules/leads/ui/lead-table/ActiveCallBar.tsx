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
 * Vapi listen stream sends linear16 PCM at either 16kHz (2ch) or 8kHz (1ch).
 * We use AudioContext at 16kHz and resample 8kHz data if needed.
 */
const PLAYBACK_RATE = 16000;

/**
 * Decode mu-law byte to 16-bit linear PCM sample (ITU-T G.711).
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
  const stoppedRef = useRef(false);
  const formatDetectedRef = useRef<"pcm16_stereo" | "pcm16_mono" | "mulaw" | null>(null);
  const callIdRef = useRef<string | null>(null);

  const fetchActive = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/active");
      if (res.ok) {
        const json = await res.json();
        const active = json.active ?? null;
        // Only update state if the call ID actually changed to avoid
        // re-renders that would kill the WebSocket connection
        setCall((prev) => {
          if (prev?.id === active?.id && prev?.status === active?.status) {
            return prev;
          }
          return active;
        });
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

  // Clean up WebSocket when the call ID changes or disappears
  useEffect(() => {
    const newId = call?.id ?? null;
    if (callIdRef.current && callIdRef.current !== newId) {
      // Call changed or ended — stop listening
      stopListening();
    }
    callIdRef.current = newId;
  }, [call]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => stopListening();
  }, []);

  function stopListening() {
    stoppedRef.current = true;
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
    stoppedRef.current = false;
    formatDetectedRef.current = null;

    const audioCtx = new AudioContext({ sampleRate: PLAYBACK_RATE });
    // Mobile browsers require explicit resume() — AudioContext starts suspended
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    audioCtxRef.current = audioCtx;
    nextPlayTimeRef.current = audioCtx.currentTime;

    const ws = new WebSocket(call.listen_url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      // Skip text frames (JSON control messages from Vapi)
      if (typeof event.data === "string") return;

      // Handle both ArrayBuffer and Blob (defensive for non-conformant browsers)
      let buffer: ArrayBuffer;
      if (event.data instanceof ArrayBuffer) {
        buffer = event.data;
      } else if (event.data instanceof Blob) {
        buffer = await event.data.arrayBuffer();
        // After awaiting, verify we haven't stopped (AudioContext may be closed)
        if (stoppedRef.current) return;
      } else {
        return;
      }

      const raw = new Uint8Array(buffer);
      // Skip very small frames (likely keep-alive or control)
      if (raw.length < 160) return;

      let pcm: Float32Array;
      let sampleRate: number;

      // Auto-detect format from first substantial frame
      if (!formatDetectedRef.current) {
        // Heuristic: if every byte is in mu-law range and frame size matches
        // 8kHz * 20ms = 160 bytes for mu-law, or multiples thereof.
        // PCM16 mono at 16kHz * 20ms = 640 bytes (320 samples * 2 bytes).
        // PCM16 stereo at 16kHz * 20ms = 1280 bytes.
        // Telephony mu-law is typically 160/320 byte frames at 8kHz.
        const isLikelyMulaw = raw.length === 160 || raw.length === 320;
        const isLikelyPcmStereo = raw.length % 4 === 0 && raw.length >= 1280;

        if (isLikelyMulaw) {
          formatDetectedRef.current = "mulaw";
        } else if (isLikelyPcmStereo && raw.length >= 1280) {
          formatDetectedRef.current = "pcm16_stereo";
        } else {
          // Default: treat as PCM16 mono
          formatDetectedRef.current = "pcm16_mono";
        }
      }

      const format = formatDetectedRef.current;

      if (format === "mulaw") {
        // Mu-law 8kHz mono: each byte is one sample
        sampleRate = 8000;
        pcm = new Float32Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          pcm[i] = mulawDecode(raw[i]) / 32768;
        }
      } else if (format === "pcm16_stereo") {
        // PCM s16le 16kHz stereo: mix to mono
        sampleRate = 16000;
        const frameCount = Math.floor(raw.length / 4);
        pcm = new Float32Array(frameCount);
        const view = new DataView(buffer);
        for (let i = 0; i < frameCount; i++) {
          const ch0 = view.getInt16(i * 4, true) / 32768;
          const ch1 = view.getInt16(i * 4 + 2, true) / 32768;
          pcm[i] = (ch0 + ch1) * 0.5;
        }
      } else {
        // PCM s16le mono (16kHz or 8kHz — assume 16kHz)
        sampleRate = 16000;
        const sampleCount = Math.floor(raw.length / 2);
        pcm = new Float32Array(sampleCount);
        const view = new DataView(buffer);
        for (let i = 0; i < sampleCount; i++) {
          pcm[i] = view.getInt16(i * 2, true) / 32768;
        }
      }

      // Create audio buffer at the detected sample rate
      const audioBuf = audioCtx.createBuffer(1, pcm.length, sampleRate);
      audioBuf.getChannelData(0).set(pcm);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      const playAt = Math.max(nextPlayTimeRef.current, now);
      source.start(playAt);
      nextPlayTimeRef.current = playAt + audioBuf.duration;
    };

    ws.onclose = () => {
      if (!stoppedRef.current) {
        // Unexpected close — try to reconnect after 1s
        setListening(false);
        setTimeout(() => {
          if (!stoppedRef.current && call?.listen_url) {
            startListening();
          }
        }, 1000);
      } else {
        setListening(false);
      }
    };

    ws.onerror = () => {
      // Let onclose handle reconnect
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
