(function () {
  const { useMemo, useState } = React;
  const buildExpertPrompt = window.AB.scenario.buildExpertPrompt;
  const LANGUAGE_CATALOG = window.AB.scenario.LANGUAGE_CATALOG;
  const findLanguage = window.AB.scenario.findLanguage;

  const BEHAVIOR_LABELS = {
    interrupt_once: "Interrupt once (use operator push-to-talk during the demo)",
    ask_repeat: "Ask to repeat once",
    off_topic: "Ask an off-topic question",
  };

  /** Dispatches on scenario.kind -- a "prompt_override" scenario has no persona/questions/
   * behaviors structure, it's free-form text, so it gets a completely different, much shorter
   * form instead of branching line-by-line inside one giant component. */
  function ScenarioEditor({ scenario, onChange }) {
    if (scenario.kind === "prompt_override") {
      return <PromptOverrideScenarioEditor scenario={scenario} onChange={onChange} />;
    }
    return <DeterministicScenarioEditor scenario={scenario} onChange={onChange} />;
  }

  function DeterministicScenarioEditor({ scenario, onChange }) {
    const [showPreview, setShowPreview] = useState(false);
    const preview = useMemo(() => buildExpertPrompt(scenario), [scenario]);

    function set(key, value) {
      onChange({ ...scenario, [key]: value });
    }

    function toggleBehavior(behavior) {
      const has = scenario.behaviors.includes(behavior);
      set("behaviors", has ? scenario.behaviors.filter((b) => b !== behavior) : [...scenario.behaviors, behavior]);
    }

    function setQuestionText(index, text) {
      const next = [...scenario.questions];
      next[index] = { ...next[index], text };
      set("questions", next);
    }

    function setQuestionLanguage(index, language) {
      const next = [...scenario.questions];
      next[index] = { ...next[index], language };
      set("questions", next);
    }

    function applyLanguageToAllQuestions() {
      set(
        "questions",
        scenario.questions.map((q) => ({ ...q, language: scenario.language })),
      );
    }

    function selectLanguage(code) {
      const lang = findLanguage(code);
      // One atomic update: code and display name can never drift apart again
      // (spec-agent-appelant.md section 2 -- caller_language_name must be the
      // language's name, the ISO code only goes into the agent.language override).
      onChange({ ...scenario, language: lang.code, languageName: lang.name, languageStyle: lang.defaultStyle });
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
            <select value={scenario.firstSpeaker} onChange={(e) => set("firstSpeaker", e.target.value)}>
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
            Language
            <select value={scenario.language} onChange={(e) => selectLanguage(e.target.value)}>
              {LANGUAGE_CATALOG.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Language style / variant
            <input value={scenario.languageStyle} onChange={(e) => set("languageStyle", e.target.value)} placeholder="polite keigo, natural Tokyo speech" />
          </label>
          <label>
            Voice ID (override)
            <input value={scenario.voiceId || ""} onChange={(e) => set("voiceId", e.target.value || undefined)} />
          </label>
        </div>

        {scenario.firstSpeaker === "caller" && (
          <div className="card-row">
            <label className="grow">
              Opening line (first_message)
              <input value={scenario.openingLine || ""} onChange={(e) => set("openingLine", e.target.value)} />
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
            <select value={scenario.verbosity} onChange={(e) => set("verbosity", e.target.value)}>
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
          <p className="panel-help">
            Write each question in whatever language is convenient -- the caller translates it on the fly and
            switches its own spoken language to match the tag before asking it.
          </p>
          <div className="card-row">
            <button
              type="button"
              onClick={applyLanguageToAllQuestions}
              title={`Set every question's language tag to the scenario's default (${scenario.languageName})`}
            >
              Apply "{scenario.languageName}" to all questions
            </button>
          </div>
          {scenario.questions.map((q, i) => (
            <div className="card-row" key={i}>
              <input className="grow" value={q.text} onChange={(e) => setQuestionText(i, e.target.value)} placeholder={`Question ${i + 1}`} />
              <select value={q.language} onChange={(e) => setQuestionLanguage(i, e.target.value)}>
                {LANGUAGE_CATALOG.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name} ({lang.code})
                  </option>
                ))}
              </select>
              <button className="danger" onClick={() => set("questions", scenario.questions.filter((_, idx) => idx !== i))}>
                Remove
              </button>
            </div>
          ))}
          {scenario.questions.length < 8 && (
            <button onClick={() => set("questions", [...scenario.questions, { text: "", language: scenario.language }])}>
              + Add question
            </button>
          )}
        </fieldset>

        <fieldset>
          <legend>Behaviors</legend>
          {Object.keys(BEHAVIOR_LABELS).map((b) => (
            <label key={b} className="checkbox-row">
              <input type="checkbox" checked={scenario.behaviors.includes(b)} onChange={() => toggleBehavior(b)} />
              {BEHAVIOR_LABELS[b]}
            </label>
          ))}
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
            <input value={scenario.calleeLanguageOverride || ""} onChange={(e) => set("calleeLanguageOverride", e.target.value || undefined)} placeholder="leave empty for auto-detection" />
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

  /** A "prompt_override" scenario for a free-form Caller Prompt Override agent (see
   * caller_agent_prompt_override/): promptOverride IS the caller's entire system prompt for the
   * session, written by hand or pasted from an existing ElevenLabs test's `simulation_scenario`.
   * successConditions is a plain checklist shown next to the transcript -- there is no automated
   * judge in this app, a human reads the transcript against it. */
  function PromptOverrideScenarioEditor({ scenario, onChange }) {
    function set(key, value) {
      onChange({ ...scenario, [key]: value });
    }

    function selectLanguage(code) {
      const lang = findLanguage(code);
      onChange({ ...scenario, language: lang.code, languageName: lang.name });
    }

    function setCondition(index, text) {
      const next = [...scenario.successConditions];
      next[index] = text;
      set("successConditions", next);
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
            <select value={scenario.firstSpeaker} onChange={(e) => set("firstSpeaker", e.target.value)}>
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
            Language
            <select value={scenario.language} onChange={(e) => selectLanguage(e.target.value)}>
              {LANGUAGE_CATALOG.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Voice ID (override)
            <input value={scenario.voiceId || ""} onChange={(e) => set("voiceId", e.target.value || undefined)} />
          </label>
        </div>

        {scenario.firstSpeaker === "caller" && (
          <div className="card-row">
            <label className="grow">
              Opening line (first_message)
              <input value={scenario.openingLine || ""} onChange={(e) => set("openingLine", e.target.value)} />
            </label>
          </div>
        )}

        <fieldset>
          <legend>Prompt override</legend>
          <p className="panel-help">
            This text becomes the caller's entire system prompt for the session -- no persona/questions template, write it exactly as you want
            the model to read it. Write it in whatever language the call should happen in.
          </p>
          <textarea
            className="prompt-override-textarea"
            value={scenario.promptOverride}
            onChange={(e) => set("promptOverride", e.target.value)}
            rows={14}
            placeholder={'Vous etes Sebastien Bobilier... Quand le bot vous demande les circonstances, repondez de facon incomprehensible DEUX fois de suite avant de clarifier.\n\nIMPORTANT: only the agent you are calling may end the call. Never end it yourself.'}
          />
        </fieldset>

        <fieldset>
          <legend>Success conditions (checklist shown next to the transcript -- not auto-graded)</legend>
          {scenario.successConditions.map((c, i) => (
            <div className="card-row" key={i}>
              <input className="grow" value={c} onChange={(e) => setCondition(i, e.target.value)} placeholder={`Condition ${i + 1}`} />
              <button className="danger" onClick={() => set("successConditions", scenario.successConditions.filter((_, idx) => idx !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button onClick={() => set("successConditions", [...scenario.successConditions, ""])}>+ Add condition</button>
        </fieldset>

        {Object.keys(scenario.importedDynamicVariables || {}).length > 0 && (
          <fieldset>
            <legend>Dynamic variables from the imported test (reference only)</legend>
            <p className="panel-help">
              This test's own {scenario.importedFrom ? `(${scenario.importedFrom}) ` : ""}dynamic variables, for reference when wiring this scenario into a Preset -- a Scenario itself can't carry
              callee dynamic variable overrides in this app (those live on the Preset, per scenario, since the same scenario can be reused against a different callee agent). Set them on a
              Preset's per-scenario override once you build one using this scenario.
            </p>
            <table className="table">
              <tbody>
                {Object.entries(scenario.importedDynamicVariables || {}).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="mono">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        )}

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
            <input value={scenario.calleeLanguageOverride || ""} onChange={(e) => set("calleeLanguageOverride", e.target.value || undefined)} placeholder="leave empty for auto-detection" />
          </label>
        </div>
      </div>
    );
  }

  window.AB.ui.settings.ScenarioEditor = ScenarioEditor;
})();
