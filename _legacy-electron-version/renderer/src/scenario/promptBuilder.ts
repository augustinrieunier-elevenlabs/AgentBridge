/**
 * Builds the "expert mode" full prompt override (spec-agent-appelant.md section 7.3)
 * and the conversation_config_override payloads sent to the caller and callee
 * websockets (spec-agent-appelant.md section 7.1, schema verified against
 * https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
 * on 2026-10-01).
 */
import type { Scenario } from "../../../shared/types";
import { buildBehaviorInstructions, buildQuestionsList } from "./dynamicVariables";

/** Level-1 system prompt template from spec-agent-appelant.md section 4, used only when Scenario.expertMode is on. */
export function buildExpertPrompt(scenario: Scenario): string {
  const questions = buildQuestionsList(scenario.questions);
  const behaviorInstructions = buildBehaviorInstructions(scenario);

  return `# Role
You are ${scenario.personaName}, a real human customer making a phone call to ${scenario.calleeBusiness}.
You are NOT an assistant. You never offer help, never summarize, never use lists or formatting.
The person who answers the phone is the business's representative. You are the caller.

# Language
You speak ONLY ${scenario.languageName} (${scenario.languageStyle}), from your first word to your last,
even if the other person speaks another language — in that case, politely ask them in ${scenario.languageName}
whether they can speak ${scenario.languageName}, and keep going in ${scenario.languageName}.
Never translate what you say. Never mention which language you speak unless asked.

# Personality
${scenario.personaDescription}
Current mood: ${scenario.callerMood}. Let it show subtly in your wording, never exaggerated.

# Situation
${scenario.context}
Your goal: ${scenario.callGoal}.

# Your questions (ask them in this order)
${questions}

# How you talk
- Speak like a person on the phone: ${scenario.verbosity} sentences, spoken style, natural fillers are fine but rare.
- ONE question per turn. Then stop talking and wait for the answer.
- React briefly and naturally to each answer (thanks, short acknowledgement) before the next question.
- If an answer is vague or incomplete, ask ONE short follow-up, then move on.
- If you didn't understand, ask them to repeat or rephrase.
- If you are asked for details about yourself, use only: ${scenario.personalDetails || "nothing specific — invent a plausible, harmless answer"}. If something isn't listed, invent a plausible, harmless answer and stay consistent.
- If you are put on hold ("one moment please"), say a short acknowledgement or stay silent and wait (use skip_turn).
- Never reveal you are an AI, a simulation, or a test. If asked, deflect naturally as a human would.

# Special instructions for this call
${behaviorInstructions}

# Ending the call
End the call ${scenario.endGoal}.
To end: thank them, say goodbye in ${scenario.languageName}, then call the end_call tool.`;
}

export type ConversationConfigOverride = {
  agent?: { prompt?: { prompt: string }; first_message?: string; language?: string };
  tts?: { voice_id?: string; speed?: number };
  asr?: { keywords?: string[] };
  conversation?: { max_duration_seconds?: number };
};

/** Overrides sent on the caller's websocket (spec-agent-appelant.md 7.1 + spec-agent-bridge-demo.md 6.3). */
export function buildCallerOverride(scenario: Scenario): ConversationConfigOverride {
  const override: ConversationConfigOverride = {
    agent: {
      first_message: scenario.firstSpeaker === "caller" ? scenario.openingLine || "" : "",
      language: scenario.language,
    },
    conversation: { max_duration_seconds: scenario.maxDurationSec },
  };
  if (scenario.voiceId) override.tts = { voice_id: scenario.voiceId };
  if (scenario.asrKeywords.length > 0) override.asr = { keywords: scenario.asrKeywords };
  if (scenario.expertMode) {
    override.agent = { ...override.agent, prompt: { prompt: buildExpertPrompt(scenario) } };
  }
  return override;
}

/**
 * Overrides sent on the callee's websocket. Per spec-agent-bridge-demo.md section 6.3,
 * the callee is demonstrated as configured in its own dashboard: send only what the
 * scenario explicitly requires (a forced language, or silence as first speaker).
 */
export function buildCalleeOverride(scenario: Scenario): ConversationConfigOverride | undefined {
  const override: ConversationConfigOverride = {};
  let hasAnyField = false;

  if (scenario.calleeLanguageOverride) {
    override.agent = { ...override.agent, language: scenario.calleeLanguageOverride };
    hasAnyField = true;
  }
  if (scenario.firstSpeaker === "callee") {
    // Caller opens the line with silence; callee must speak first -- nothing to override here.
  } else {
    override.agent = { ...override.agent, first_message: "" };
    hasAnyField = true;
  }

  return hasAnyField ? override : undefined;
}
