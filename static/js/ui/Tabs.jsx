(function () {
  function Tabs({ value, options, onChange }) {
    return (
      <div className="tabs">
        {options.map((opt) => (
          <button key={opt.value} className={`tab ${opt.value === value ? "tab-active" : ""}`} onClick={() => onChange(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  window.AB.ui.Tabs = Tabs;
})();
