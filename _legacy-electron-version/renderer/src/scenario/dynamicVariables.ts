/**
 * Builds the dynamic_variables payload for the Caller Simulator agent, per
 * the contract in spec-agent-appelant.md section 2. The agent's own dashboard
 * prompt consumes these {{variables}} directly -- this app never resends the
 * base prompt unless Scenario.expertMode is set (see promptBuilder.ts).
 */
import type { Scenario } from "../../../shared/types";

const MAX_FIELD_LENGTH = 1000;
const MAX_QUESTIONS = 8;

export type ValidationIssue = { field: string; message: string };

const BEHAVIOR_TEXT: Record<string, string> = {
  ask_repeat:
    "Once during the call, after an answer, say you didn't catch it and ask them to repeat more slowly.",
  off_topic:
    "After your second question, ask one unrelated but plausible question (e.g. a restaurant recommendation nearby). Accept any answer, then continue.",
  switch_language: "__SWITCH_LANGUAGE__", // filled in with the target language below
};

export function buildBehaviorInstructions(scenario: Scenario): string {
  const lines: string[] = [];
  for (const behavior of scenario.behaviors) {
    if (behavior === "interrupt_once") continue; // handled via operator push-to-talk, not a prompt instruction
    if (behavior === "switch_language") {
      lines.push(
        `After your second question, switch to ${scenario.switchLanguageTarget || "English"} for the rest of the call, as if you were more comfortable in it.`,
      );
    } else if (BEHAVIOR_TEXT[behavior]) {
      lines.push(BEHAVIOR_TEXT[behavior]);
    }
  }
  return lines.length > 0 ? lines.join(" ") : "None.";
}

export function buildQuestionsList(questions: string[]): string {
  return questions
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .slice(0, MAX_QUESTIONS)
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");
}

export function buildDynamicVariables(scenario: Scenario): Record<string, string | number | boolean> {
  const questions = scenario.questions.map((q) => q.trim()).filter((q) => q.length > 0).slice(0, MAX_QUESTIONS);

  const vars: Record<string, string | number | boolean> = {
    scenario_id: scenario.id,
    caller_language_name: scenario.languageName,
    caller_language_style: scenario.languageStyle,
    persona_name: scenario.personaName,
    persona_description: scenario.personaDescription,
    caller_mood: scenario.callerMood,
    verbosity: scenario.verbosity,
    callee_business: scenario.calleeBusiness,
    call_context: scenario.context,
    call_goal: scenario.callGoal,
    questions_list: buildQuestionsList(questions),
    questions_count: questions.length,
    personal_details: scenario.personalDetails || "None provided.",
    behavior_instructions: buildBehaviorInstructions(scenario),
    behavior_off_topic: scenario.behaviors.includes("off_topic"),
    behavior_ask_repeat: scenario.behaviors.includes("ask_repeat"),
    behavior_switch_language: scenario.behaviors.includes("switch_language"),
    switch_language_target: scenario.switchLanguageTarget || "English",
    end_condition: scenario.endGoal,
    opening_line: scenario.firstSpeaker === "caller" ? scenario.openingLine || "" : "",
    // Workflow-level (level 2) working variables; initialised defensively even
    // though update_state normally owns them from the dashboard side (spec-agent-appelant.md 6.4).
    questions_done: 0,
    detour_done: false,
  };

  return vars;
}

export function validateDynamicVariables(vars: Record<string, string | number | boolean>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (key.startsWith("system__")) {
      issues.push({ field: key, message: "Reserved system__ prefix must never be sent by the app." });
    }
    if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
      issues.push({ field: key, message: `Value exceeds ${MAX_FIELD_LENGTH} characters.` });
    }
  }
  return issues;
}
