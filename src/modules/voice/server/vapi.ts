import "server-only";

const VAPI_API_BASE = "https://api.vapi.ai";

function getVapiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error("VAPI_API_KEY is not configured");
  return key;
}

export type VapiCreateCallParams = {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
  assistantOverrides?: {
    variableValues?: Record<string, string>;
    voice?: { provider: string; voiceId: string; language?: string };
    firstMessage?: string;
    voicemailMessage?: string;
    model?: {
      provider: string;
      model: string;
      messages: { role: string; content: string }[];
    };
    voicemailDetection?: {
      provider: string;
      enabled: boolean;
      voicemailDetectionTypes: string[];
      backoffPlan?: {
        startAtSeconds?: number;
        frequencySeconds?: number;
        maxRetries?: number;
      };
    };
  };
  schedulePlan?: {
    earliestAt?: string;
  };
};

export type VapiCallResponse = {
  id: string;
  status: string;
  phoneNumberId: string;
  customer: { number: string };
  createdAt: string;
  monitor?: {
    listenUrl?: string;
    controlUrl?: string;
  };
};

export async function createOutboundCall(
  params: VapiCreateCallParams
): Promise<VapiCallResponse> {
  const res = await fetch(`${VAPI_API_BASE}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getVapiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId: params.assistantId,
      phoneNumberId: params.phoneNumberId,
      customer: { number: params.customerNumber },
      ...(params.assistantOverrides && {
        assistantOverrides: params.assistantOverrides,
      }),
      ...(params.schedulePlan && { schedulePlan: params.schedulePlan }),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vapi createCall failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getVapiCall(callId: string): Promise<VapiCallResponse> {
  const res = await fetch(`${VAPI_API_BASE}/call/${callId}`, {
    headers: { Authorization: `Bearer ${getVapiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`Vapi getCall failed (${res.status})`);
  }
  return res.json();
}
