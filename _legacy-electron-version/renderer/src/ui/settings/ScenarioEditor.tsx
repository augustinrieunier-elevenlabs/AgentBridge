import React, { useMemo, useState } from "react";
import type { Scenario, ScenarioBehavior } from "../../../../shared/types";
import { buildExpertPrompt } from "../../scenario/promptBuilder";

const BEHAVIOR_LABELS: Record<ScenarioBehavior, string> = {
  interrupt_once: "Interrupt once (use operator push-to-talk during the demo)",
  ask_repeat: "Ask to repeat once",
  switch_language: "Switch language mid-call",
  off_topic: "Ask an off-topic question",
};

export function ScenarioEditor({ scenario, onChange }: { scenario: Scenario; onChange: (s: Scenario) => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const preview = useMemo(() => buildExpertPrompt(scenario), [scenario]);

  function set<K extends keyof Scenario>(key: K, value: Scenario[K]) {
    onChange({ ...scenario, [key]: value });
  }

  function toggleBehavior(behavior: ScenarioBehavior) {
    const has = scenario.behaviors.includes(behavior);
    set("behaviors", has ? scenario.behaviors.filter((b) => b !== behavior) : [...scenario.behaviors, behavior]);
  }

  function setQuestion(index: number, value: string) {
    const next = [...scenario.questions];
    next[index] = value;
    set("questions", next);
  }

  return (
    <div className="card">
      <div className="card-row">
        <label>
          Name
          <input value={scenario.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          First speaker
          <select value={scenario.firstSpeaker} onChange={(e) => set("firstSpeaker", e.target.value as Scenario["firstSpeaker"])}>
            <option value="callee">Callee answers first (incoming call)</option>
            <option value="caller">Caller opens</option>
          </select>
        </label>
        <label>
          Max duration (s)
          <input type="number" value={scenario.maxDurationSec} onChange={(e) => set("maxDurationSec", Number(e.target.value))} />
        </label>
      </div>

      <div className="card-row">
        <label>
          Language code (override)
          <input value={scenario.language} onChange={(e) => set("language", e.target.value)} placeholder="ja" />
        </label>
        <label>
          Language name (for the prompt)
          <input value={scenario.languageName} onChange={(e) => set("languageName", e.target.value)} placeholder="Japanese" />
        </label>
        <label>
          Language style / variant
          <input value={scenario.languageStyle} onChange={(e) => set("languageStyle", e.target.value)} placeholder="polite keigo, natural Tokyo speech" />
        </label>
        <label>
          Voice ID (override)
          <input value={scenario.voiceId ?? ""} onChange={(e) => set("voiceId", e.target.value || undefined)} />
        </label>
      </div>

      {scenario.firstSpeaker === "caller" && (
        <div className="card-row">
          <label className="grow">
            Opening line (first_message)
            <input value={scenario.openingLine ?? ""} onChange={(e) => set("openingLine", e.target.value)} />
          </label>
        </div>
      )}

      <div className="card-row">
        <label>
          Persona name
          <input value={scenario.personaName} onChange={(e) => set("personaName", e.target.value)} placeholder="Kenji Tanaka" />
        </label>
        <label>
          Mood
          <input value={scenario.callerMood} onChange={(e) => set("callerMood", e.target.value)} placeholder="in a hurry" />
        </label>
        <label>
          Verbosity
          <select value={scenario.verbosity} onChange={(e) => set("verbosity", e.target.value as Scenario["verbosity"])}>
            <option value="very short">Very short</option>
            <option value="short">Short</option>
            <option value="natural">Natural</option>
          </select>
        </label>
      </div>

      <label>
        Persona description
        <textarea value={scenario.personaDescription} onChange={(e) => set("personaDescription", e.target.value)} rows={2} />
      </label>

      <div className="card-row">
        <label className="grow">
          Callee business (who they're calling)
          <input value={scenario.calleeBusiness} onChange={(e) => set("calleeBusiness", e.target.value)} />
        </label>
      </div>

      <label>
        Context / situation
        <textarea value={scenario.context} onChange={(e) => set("context", e.target.value)} rows={2} />
      </label>
      <label>
        Call goal
        <input value={scenario.callGoal} onChange={(e) => set("callGoal", e.target.value)} />
      </label>
      <label>
        Personal details (fictional only -- never real PII, spec-agent-bridge-demo.md section 10)
        <input value={scenario.personalDetails} onChange={(e) => set("personalDetails", e.target.value)} />
      </label>

      <fieldset>
        <legend>Questions (ordered, max 8)</legend>
        {scenario.questions.map((q, i) => (
          <div className="card-row" key={i}>
            <input className="grow" value={q} onChange={(e) => setQuestion(i, e.target.value)} placeholder={`Question ${i + 1}`} />
            <button className="danger" onClick={() => set("questions", scenario.questions.filter((_, idx) => idx !== i))}>
              Remove
            </button>
          </div>
        ))}
        {scenario.questions.length < 8 && <button onClick={() => set("questions", [...scenario.questions, ""])}>+ Add question</button>}
      </fieldset>

      <fieldset>
        <legend>Behaviors</legend>
        {(Object.keys(BEHAVIOR_LABELS) as ScenarioBehavior[]).map((b) => (
          <label key={b} className="checkbox-row">
            <input type="checkbox" checked={scenario.behaviors.includes(b)} onChange={() => toggleBehavior(b)} />
            {BEHAVIOR_LABELS[b]}
          </label>
        ))}
        {scenario.behaviors.includes("switch_language") && (
          <label>
            Switch-language target
            <input value={scenario.switchLanguageTarget ?? ""} onChange={(e) => set("switchLanguageTarget", e.target.value)} placeholder="English" />
          </label>
        )}
      </fieldset>

      <label>
        End condition
        <input value={scenario.endGoal} onChange={(e) => set("endGoal", e.target.value)} />
      </label>

      <div className="card-row">
        <label>
          ASR keywords (comma separated)
          <input
            value={scenario.asrKeywords.join(", ")}
            onChange={(e) => set("asrKeywords", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          />
        </label>
        <label>
          Callee language override (optional)
          <input value={scenario.calleeLanguageOverride ?? ""} onChange={(e) => set("calleeLanguageOverride", e.target.value || undefined)} placeholder="leave empty for auto-detection" />
        </label>
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={Boolean(scenario.expertMode)} onChange={(e) => set("expertMode", e.target.checked)} />
        Expert mode -- also override the caller's full system prompt (requires the prompt override to be enabled on the agent)
      </label>

      <div className="card-row">
        <button onClick={() => setShowPreview((v) => !v)}>{showPreview ? "Hide" : "Show"} generated prompt preview</button>
      </div>
      {showPreview && <pre className="prompt-preview">{preview}</pre>}
    </div>
  );
}
