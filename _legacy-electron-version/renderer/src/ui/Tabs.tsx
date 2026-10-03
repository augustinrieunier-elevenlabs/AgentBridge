import React from "react";

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
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
