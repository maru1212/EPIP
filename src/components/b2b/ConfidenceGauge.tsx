export interface ConfidenceGaugeProps {
  /** 0-1 scale, matching ValuationReport.confidenceScore. */
  confidenceScore: number;
}

function toneFor(percent: number): { track: string; text: string; label: string } {
  if (percent >= 70) return { track: "#639922", text: "#173404", label: "High confidence" };
  if (percent >= 40) return { track: "#EF9F27", text: "#412402", label: "Moderate confidence" };
  return { track: "#E24B4A", text: "#501313", label: "Low confidence" };
}

export function ConfidenceGauge({ confidenceScore }: ConfidenceGaugeProps) {
  const percent = Math.round(Math.max(0, Math.min(1, confidenceScore)) * 100);
  const { track, text, label } = toneFor(percent);

  return (
    <div className="flex flex-col gap-2" data-testid="confidence-gauge">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-stone-700">Confidence rating</span>
        <span className="text-2xl font-semibold" style={{ color: text }}>
          {percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Confidence rating"
        className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${percent}%`, backgroundColor: track }}
        />
      </div>
      <span className="text-xs text-stone-500">{label}</span>
    </div>
  );
}
