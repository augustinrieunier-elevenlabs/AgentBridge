/**
 * Builds the dynamic_variables payload for the Caller Simulator agent, per
 * the contract in spec-agent-appelant.md section 2. The agent's own dashboard
 * prompt consumes these {{variables}} directly -- this app never resends the
 * base prompt unless Scenario.expertMode is set (see promptBuilder.js).
 *
 * Scenario shape (plain object, see model/factory.js for a fresh one):
 *   { id, name, language, languageName, languageStyle, voiceId, personaName,
 *     personaDescription, callerMood, verbosity, calleeBusiness, context,
 *     callGoal, questions: {text, language}[], personalDetails, behaviors: string[],
 *     endGoal, maxDurationSec, firstSpeaker,
 *     openingLine, asrKeywords: string[], calleeLanguageOverride, expertMode }
 *
 * Each question carries its own target language (an ISO code from
 * LANGUAGE_CATALOG). The written question text can stay in whatever language
 * is convenient for whoever is building the scenario -- the agent translates
 * it on the fly and switches its spoken language per question using the
 * language_detection tool (see languageCatalog.js and the agent's own prompt
 * in caller_agent/, updated 2026-10-01 to replace the old single global
 * "switch_language" behavior, which depended on an unreliable LLM-timed
 * detour and could never express more than one switch per call).
 */
(function () {
  const MAX_FIELD_LENGTH = 1000;
  const MAX_QUESTIONS = 8;

  const BEHAVIOR_TEXT = {
    ask_repeat: "Once during the call, after an answer, say you didn't catch it and ask them to repeat more slowly.",
    off_topic:
      "After your second question, ask one unrelated but plausible question (e.g. a restaurant recommendation nearby). Accept any answer, then continue.",
  };

  function buildBehaviorInstructions(scenario) {
    const lines = [];
    for (const behavior of scenario.behaviors) {
      if (behavior === "interrupt_once") continue; // handled via operator push-to-talk, not a prompt instruction
      if (BEHAVIOR_TEXT[behavior]) lines.push(BEHAVIOR_TEXT[behavior]);
    }
    return lines.length > 0 ? lines.join(" ") : "None.";
  }

  function buildQuestionsList(questions) {
    return questions
      .map((q) => ({ text: q.text.trim(), language: q.language }))
      .filter((q) => q.text.length > 0)
      .slice(0, MAX_QUESTIONS)
      .map((q, i) => `${i + 1}. [${q.language}] ${q.text}`)
      .join("\n");
  }

  function buildDynamicVariables(scenario) {
    // A prompt_override scenario's caller has no {{variable}} contract at all -- the whole
    // prompt is sent verbatim as a session override (see promptBuilder.js buildPromptOverrideText).
    if (scenario.kind === "prompt_override") return {};

    const questions = scenario.questions
      .map((q) => ({ text: q.text.trim(), language: q.language }))
      .filter((q) => q.text.length > 0)
      .slice(0, MAX_QUESTIONS);

    return {
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
      end_condition: scenario.endGoal,
      opening_line: scenario.firstSpeaker === "caller" ? scenario.openingLine || "" : "",
      // Workflow-level (level 2) working variables; initialised defensively even
      // though update_state normally owns them from the dashboard side (spec-agent-appelant.md 6.4).
      questions_done: 0,
      detour_done: false,
    };
  }

  function validateDynamicVariables(vars) {
    const issues = [];
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

  window.AB.scenario.buildBehaviorInstructions = buildBehaviorInstructions;
  window.AB.scenario.buildQuestionsList = buildQuestionsList;
  window.AB.scenario.buildDynamicVariables = buildDynamicVariables;
  window.AB.scenario.validateDynamicVariables = validateDynamicVariables;
})();
