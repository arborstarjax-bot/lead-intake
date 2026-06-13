export { getVoiceConfig, upsertVoiceConfig, type VoiceAgentConfig, type VoiceAgentConfigPatch } from "./config";
export { insertCall, updateCall, getCallByVapiId, getCallsForLead, getActiveCallCount, type AiCall, type AiCallInsert } from "./calls";
export { createOutboundCall, getVapiCall, type VapiCreateCallParams } from "./vapi";
export { guessGender, selectVoiceForLead, type GenderGuess } from "./gender";
export { createVapiAssistant, listVapiPhoneNumbers, deleteVapiAssistant, type ProvisionParams, type ProvisionResult } from "./provision";
export { generateSystemPrompt, generateFirstMessage, generateVoicemailMessage } from "./prompt-template";
