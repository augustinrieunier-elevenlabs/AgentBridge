import { describe, it, expect } from "vitest";
import { buildExpertPrompt, buildCallerOverride, buildCalleeOverride } from "../scenario/promptBuilder";
import { buildDynamicVariables, buildBehaviorInstructions, buildQuestionsList, validateDynamicVariables } from "../scenario/dynamicVariables";
import { emptyScenario } from "../model/factory";

function baseScenario() {
  return {
    ...emptyScenario(),
    language: "ja",
    languageName: "Japanese",
    languageStyle: "polite keigo",
    personaName: "Kenji",
    calleeBusiness: "Hotel Le Marais",
    questions: ["What time is breakfast?", "Is there parking?", ""],
  };
}

describe("dynamicVariables", () => {
  it("builds the numbered questions list, dropping empty entries", () => {
    expect(buildQuestionsList(["A", "", "B"])).toBe("1. A\n2. B");
  });

  it("caps questions at 8", () => {
    const many = Array.from({ length: 10 }, (_, i) => `Q${i}`);
    expect(buildQuestionsList(many).split("\n")).toHaveLength(8);
  });

  it("never emits a system__ prefixed key", () => {
    const vars = buildDynamicVariables(baseScenario());
    expect(Object.keys(vars).every((k) => !k.startsWith("system__"))).toBe(true);
    expect(validateDynamicVariables(vars)).toHaveLength(0);
  });

  it("flags a value that exceeds the length limit", () => {
    const issues = validateDynamicVariables({ call_context: "x".repeat(1001) });
    expect(issues).toHaveLength(1);
  });

  it("builds behavior instructions only for active behaviors", () => {
    const none = buildBehaviorInstructions({ ...baseScenario(), behaviors: [] });
    expect(none).toBe("None.");

    const switchLang = buildBehaviorInstructions({ ...baseScenario(), behaviors: ["switch_language"], switchLanguageTarget: "English" });
    expect(switchLang).toContain("switch to English");
  });
});

describe("promptBuilder", () => {
  it("includes the role inversion guardrail and the scenario details", () => {
    const prompt = buildExpertPrompt(baseScenario());
    expect(prompt).toContain("You are NOT an assistant");
    expect(prompt).toContain("Kenji");
    expect(prompt).toContain("Japanese");
    expect(prompt).toContain("1. What time is breakfast?");
  });

  it("builds the caller override with language and max duration always set", () => {
    const override = buildCallerOverride(baseScenario());
    expect(override.agent?.language).toBe("ja");
    expect(override.conversation?.max_duration_seconds).toBe(180);
    expect(override.agent?.prompt).toBeUndefined(); // expert mode off by default
  });

  it("includes the full prompt override only in expert mode", () => {
    const override = buildCallerOverride({ ...baseScenario(), expertMode: true });
    expect(override.agent?.prompt?.prompt).toContain("You are NOT an assistant");
  });

  it("sends an empty first_message when the callee speaks first", () => {
    const override = buildCallerOverride({ ...baseScenario(), firstSpeaker: "callee" });
    expect(override.agent?.first_message).toBe("");
  });

  it("builds no callee override unless a language override or caller-first order requires it", () => {
    expect(buildCalleeOverride(baseScenario())).toBeUndefined(); // firstSpeaker=callee, no language override
    expect(buildCalleeOverride({ ...baseScenario(), calleeLanguageOverride: "ja" })?.agent?.language).toBe("ja");
    expect(buildCalleeOverride({ ...baseScenario(), firstSpeaker: "caller" })?.agent?.first_message).toBe("");
  });
});
