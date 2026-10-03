import type { AgentRef, Scenario, SessionPreset } from "../../../shared/types";

export function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function emptyAgentRef(role: AgentRef["role"] = "both"): AgentRef {
  return { id: makeId("agent"), label: "", role, accountId: "", agentId: "" };
}

export function emptyScenario(): Scenario {
  return {
    id: makeId("scenario"),
    name: "New scenario",
    language: "en",
    languageName: "English",
    languageStyle: "neutral",
    personaName: "",
    personaDescription: "",
    callerMood: "calm",
    verbosity: "natural",
    calleeBusiness: "",
    context: "",
    callGoal: "",
    questions: [""],
    personalDetails: "",
    behaviors: [],
    endGoal: "when all questions are answered",
    maxDurationSec: 180,
    firstSpeaker: "callee",
    asrKeywords: [],
  };
}

export function emptyPreset(): SessionPreset {
  return { id: makeId("preset"), name: "New preset", callerAgentRefId: "", calleeAgentRefId: "", scenarioId: "" };
}
