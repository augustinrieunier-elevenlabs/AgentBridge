(function () {
  /**
   * Shared editor for a "variable name -> value" map, used both for an
   * agent's own hard-coded dynamic variable values and for a preset's/benchmark's
   * per-session overrides of a callee's variables (see AgentsPanel.jsx,
   * PresetsPanel.jsx, BenchmarksPanel.jsx). `placeholders` is the agent's
   * dashboard-declared {{variable}} -> default value map, introspected via
   * "Verify agent" (services/eleven_api.py get_agent -> dynamic_variable_placeholders).
   *
   * Every field's INPUT shows the current effective value by default -- inherited (e.g. the
   * preset/benchmark default, when editing a per-scenario override) falling back to the agent's
   * dashboard default -- rather than an empty box with greyed-out placeholder text the user has to
   * notice and act on. Editing a field only persists that one field as an explicit override
   * (`setValue` starts from the raw stored `values`, not the displayed effective ones), so the
   * other fields keep cascading from their source instead of getting frozen as redundant copies.
   * "Clear" removes every explicit override here, reverting the whole block to pure inheritance.
   *
   * A variable is flagged "required" when its effective value is empty -- meaning the callee's
   * prompt would literally see an empty/unsubstituted {{variable}} unless someone fills it in
   * somewhere (here, the preset/benchmark default, or the agent itself).
   */
  function DynamicVariablesEditor({ placeholders, values, onChange, title, helpText, inheritedValues }) {
    const names = Object.keys(placeholders || {});
    if (names.length === 0) return null;

    function effectiveValue(name) {
      return (values && values[name]) || (inheritedValues && inheritedValues[name]) || placeholders[name] || "";
    }

    function setValue(name, value) {
      const next = { ...values };
      if (value) next[name] = value;
      else delete next[name];
      onChange(next);
    }

    function clearAll() {
      onChange({});
    }

    const hasAnyValue = Object.keys(values || {}).length > 0;

    return (
      <fieldset>
        <legend>{title}</legend>
        {helpText && <p className="panel-help">{helpText}</p>}
        <div className="card-row">
          <button type="button" onClick={clearAll} disabled={!hasAnyValue}>
            Clear
          </button>
        </div>
        {names.map((name) => {
          const value = effectiveValue(name);
          const missing = !value;
          return (
            <div className="card-row" key={name}>
              <label className="grow">
                <span className="mono">{`{{${name}}}`}</span> {missing && <span className="badge badge-fail">required</span>}
                <input value={value} onChange={(e) => setValue(name, e.target.value)} />
              </label>
            </div>
          );
        })}
      </fieldset>
    );
  }

  window.AB.ui.settings.DynamicVariablesEditor = DynamicVariablesEditor;
})();
