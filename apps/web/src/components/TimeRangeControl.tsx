import { useCallback, useState } from "react";
import type { TimeRangePreset } from "../types.ts";

export interface TimeRangeValue {
   range: TimeRangePreset;
   from?: string;
   to?: string;
}

const PRESETS: Array<{ value: TimeRangePreset; label: string }> = [
   { value: "today", label: "Today" },
   { value: "7d", label: "7d" },
   { value: "30d", label: "30d" },
   { value: "month", label: "Month" },
   { value: "year", label: "Year" },
   { value: "custom", label: "Custom" },
];

function toLocalInput(iso: string): string {
   const date = new Date(iso);
   const pad = (n: number) => String(n).padStart(2, "0");
   return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(local: string): string {
   const date = new Date(local);
   return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function TimeRangeControl({
   value,
   onChange,
}: {
   value: TimeRangeValue;
   onChange: (next: TimeRangeValue) => void;
}) {
   const [customFrom, setCustomFrom] = useState(() =>
      toLocalInput(new Date(Date.now() - 86_400_000).toISOString()),
   );
   const [customTo, setCustomTo] = useState(() => toLocalInput(new Date().toISOString()));

   const selectPreset = useCallback(
      (preset: TimeRangePreset) => {
         if (preset !== "custom") {
               onChange({ range: preset });
               return;
                  }
         onChange({ range: "custom", from: fromLocalInput(customFrom), to: fromLocalInput(customTo) });
              },
      [customFrom, customTo, onChange],
   );

   return (
      <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: "none" }} role="group" aria-label="Time range">
             {PRESETS.map((preset) => (
                  <button
                     key={preset.value}
                     type="button"
                     className={value.range === preset.value ? "tab active" : "tab"}
                     onClick={() => selectPreset(preset.value)}
                        >
                      {preset.label}
                      </button>
                   ))}
          </div>
          {value.range === "custom" && (
             	<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                 <input
                    type="datetime-local"
                    aria-label="From"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    style={{ width: "auto" }}
                        />
                 <span className="muted">→</span>
                 <input
                    type="datetime-local"
                    aria-label="To"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                    style={{ width: "auto" }}
                        />
                 <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                           onChange({ range: "custom", from: fromLocalInput(customFrom), to: fromLocalInput(customTo) })
                                }
                        >
                    Apply
                    </button>
                 </div>
                   )}
       </div>
       );
      }
