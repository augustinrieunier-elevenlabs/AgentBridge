/**
 * Shared type definitions used by both the Electron main process and the renderer.
 * Keep this file framework-agnostic (no Electron or DOM imports) so it can be
 * imported from either side without pulling in incompatible globals.
 */

export type AccountRegion = "default" | "eu" | "in" | "us";

/**
 * An ElevenLabs account the app can act on behalf of.
 * Accounts are defined entirely in `.env` (see .env.example) and are read-only
 * from the renderer's point of view: the API key itself never leaves the main
 * process and is never included in this type.
 */
export type Account = {
  id: string; // slug derived from label, stable across .env edits as long as the label doesn't change
  label: string;
  region: AccountRegion;
  baseUrl: string; // resolved REST base URL, e.g. https://api.elevenlabs.io
  hasKey: boolean; // false => "no key" mode, only works with public agents
  lastCheck?: { ok: boolean; at: string; error?: string };
};

export type AgentRole = "caller" | "callee" | "both";

export type AgentCachedMeta = {
  name: string;
  inputFormat: string; // e.g. pcm_16000
  outputFormat: string; // e.g. pcm_16000
  language?: string;
  additionalLanguages?: string[];
  overridesEnabled: {
    agentPrompt: boolean;
    agentFirstMessage: boolean;
    agentLanguage: boolean;
    ttsVoiceId: boolean;
    ttsSpeed: boolean;
    asrKeywords: boolean;
    conversationMaxDuration: boolean;
  };
  hasEndCallTool?: boolean | "unknown";
  fetchedAt: string;
};

export type AgentRef = {
  id: string;
  label: string;
  role: AgentRole;
  accountId: string;
  agentId: string;
  cachedMeta?: AgentCachedMeta;
};

export type ScenarioBehavior = "interrupt_once" | "ask_repeat" | "switch_language" | "off_topic";

/**
 * Parameters for the Caller Simulator agent for one demo run.
 * Field names mirror the dynamic_variables contract described in
 * spec-agent-appelant.md section 2, with `language`/`variant` kept separate
 * from `languageName`/`languageStyle` so the UI can stay in French while the
 * values sent to the agent are in English (per spec-agent-appelant.md 7.2).
 */
export type Scenario = {
  id: string;
  name: string;
  language: string; // ISO code, e.g. "ja" -- used for the override, not the prompt
  languageName: string; // e.g. "Japanese" -- caller_language_name
  languageStyle: string; // e.g. "polite keigo, natural Tokyo speech" -- caller_language_style
  voiceId?: string;
  personaName: string;
  personaDescription: string;
  callerMood: string;
  verbosity: "very short" | "short" | "natural";
  calleeBusiness: string;
  context: string;
  callGoal: string;
  questions: string[]; // written in French in the UI for operator comfort, sent as-is (spec-agent-appelant.md 7.2 option a)
  personalDetails: string;
  behaviors: ScenarioBehavior[];
  switchLanguageTarget?: string;
  endGoal: string; // end_condition
  maxDurationSec: number;
  firstSpeaker: "callee" | "caller";
  openingLine?: string;
  asrKeywords: string[];
  calleeLanguageOverride?: string;
  expertMode?: boolean; // if true, also override agent.prompt.prompt with the fully generated template
};

export type SessionPreset = {
  id: string;
  name: string;
  callerAgentRefId: string;
  calleeAgentRefId: string;
  scenarioId: string;
};

export type TurnSpeaker = "caller" | "operator" | "callee";
export type TurnStatus = "live" | "final" | "interrupted" | "corrected";

export type Turn = {
  id: string;
  speaker: TurnSpeaker;
  text: string;
  status: TurnStatus;
  startedAt: number; // ms since session start
  endedAt?: number;
  latencyMs?: number; // callee only: previous turn end -> first audio chunk
  callerIntended?: string; // caller's own agent_response for ASR comparison
};

export type AudioFrameSizeMs = 20 | 50 | 100;

export type AppSettings = {
  frameSizeMs: AudioFrameSizeMs;
  outputDeviceId?: string;
  asrComparisonEnabled: boolean;
  /** language ISO code -> ElevenLabs voice_id, used to auto-fill Scenario.voiceId (spec-agent-appelant.md 3.2) */
  voiceTable: Record<string, string>;
};

export type AppConfig = {
  agents: AgentRef[];
  scenarios: Scenario[];
  presets: SessionPreset[];
  settings: AppSettings;
};

// ---- IPC contract (preload surface) -----------------------------------

export type AccountTestResult = { ok: boolean; error?: string; statusCode?: number };

export type RemoteAgentSummary = { agentId: string; name: string };

export type SignedUrlResult = { url: string };

export type FinalTranscriptResult = {
  conversationId: string;
  transcript: Array<{ role: string; message: string; timeInCallSecs?: number }>;
  raw: unknown;
};

export type BridgeApi = {
  accounts: {
    list(): Promise<Account[]>;
    test(accountId: string): Promise<AccountTestResult>;
  };
  agents: {
    listRemote(accountId: string): Promise<RemoteAgentSummary[]>;
    inspect(accountId: string, agentId: string): Promise<AgentCachedMeta>;
  };
  session: {
    getSignedUrl(accountId: string, agentId: string): Promise<SignedUrlResult>;
    fetchFinalTranscript(accountId: string, conversationId: string): Promise<FinalTranscriptResult>;
  };
  config: {
    load(): Promise<AppConfig>;
    save(cfg: AppConfig): Promise<void>;
  };
  exports: {
    save(name: string, json: unknown): Promise<{ path: string }>;
    list(): Promise<Array<{ name: string; path: string; savedAt: string }>>;
    read(path: string): Promise<unknown>;
  };
};
