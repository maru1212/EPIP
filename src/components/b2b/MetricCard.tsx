export interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-white p-4"
      data-testid="metric-card"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      <span className="text-xl font-semibold text-stone-900">{value}</span>
      {hint && <span className="text-xs text-stone-500">{hint}</span>}
    </div>
  );
}
