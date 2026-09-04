"use client";

export type ViewMode = "grid" | "split";

export interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex rounded-md border border-stone-300 bg-white p-1"
    >
      {(["grid", "split"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === option ? "bg-[#9a4a2c] text-white" : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          {option === "grid" ? "Grid" : "Map + List"}
        </button>
      ))}
    </div>
  );
}
