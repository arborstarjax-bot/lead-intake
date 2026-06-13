import "server-only";

import {
  generateSystemPrompt,
  generateFirstMessage,
  generateVoicemailMessage,
  generateToolDefinitions,
  type PromptTemplateVars,
} from "./prompt-template";

const VAPI_API_BASE = "https://api.vapi.ai";

function getVapiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error("VAPI_API_KEY is not configured");
  return key;
}

export type ProvisionParams = {
  /** Display name for the assistant e.g. "Acme Plumbing AI" */
  assistantName: string;
  /** Webhook URL for tool calls (your app's /api/voice/webhook) */
  webhookUrl: string;
  /** Optional template vars for service type customization */
  templateVars?: Partial<PromptTemplateVars>;
};

export type ProvisionResult = {
  assistantId: string;
  assistantName: string;
};

/**
 * Create a new Vapi assistant for a workspace.
 * Uses the shared prompt template with workspace-specific service details.
 */
export async function createVapiAssistant(
  params: ProvisionParams
): Promise<ProvisionResult> {
  const systemPrompt = generateSystemPrompt(params.templateVars);
  const firstMessage = generateFirstMessage(params.templateVars);
  const tools = generateToolDefinitions(params.webhookUrl);

  // Status webhook URL — receives status-update + end-of-call-report events
  const statusUrl = params.webhookUrl.replace(/\/webhook$/, "/status");

  const body = {
    name: params.assistantName,
    serverUrl: statusUrl,
    model: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "system", content: systemPrompt }],
      tools,
    },
    voice: {
      provider: "vapi",
      voiceId: "Elliot",
      language: "en-US",
    },
    firstMessage,
    voicemailMessage: generateVoicemailMessage(params.templateVars),
    startSpeakingPlan: {
      waitSeconds: 1.8,
      smartEndpointingPlan: {
        provider: "livekit",
        waitFunction: "2000 / (1 + exp(-6 * (x - 0.7)))",
      },
    },
    stopSpeakingPlan: {
      numWords: 0,
      voiceSeconds: 0.2,
      backoffSeconds: 1,
    },
    monitorPlan: {
      listenEnabled: true,
      controlEnabled: false,
    },
    voicemailDetection: {
      provider: "twilio",
      enabled: true,
      voicemailDetectionTypes: [
        "machine_end_beep",
        "machine_end_silence",
        "machine_end_other",
      ],
    },
    endCallPhrases: ["goodbye", "bye now", "have a good one"],
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 300,
    backgroundSound: "off",
    backchannelingEnabled: false,
  };

  const res = await fetch(`${VAPI_API_BASE}/assistant`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getVapiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vapi createAssistant failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    assistantId: data.id,
    assistantName: data.name,
  };
}

/**
 * List available phone numbers on the Vapi account.
 * Returns numbers not currently assigned to another workspace.
 */
export async function listVapiPhoneNumbers(): Promise<
  Array<{ id: string; number: string; name?: string }>
> {
  const res = await fetch(`${VAPI_API_BASE}/phone-number`, {
    headers: { Authorization: `Bearer ${getVapiKey()}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vapi listPhoneNumbers failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return (data ?? []).map((p: { id: string; number: string; name?: string }) => ({
    id: p.id,
    number: p.number,
    name: p.name,
  }));
}

/**
 * Delete a Vapi assistant (used when deprovisioning a workspace).
 */
export async function deleteVapiAssistant(assistantId: string): Promise<void> {
  const res = await fetch(`${VAPI_API_BASE}/assistant/${assistantId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getVapiKey()}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vapi deleteAssistant failed (${res.status}): ${text}`);
  }
}
