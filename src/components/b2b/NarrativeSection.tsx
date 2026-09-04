import type { NarrativeOutput } from "@/lib/api/types";

export function NarrativeSection({ narrative }: { narrative: NarrativeOutput | null }) {
  if (!narrative) {
    return (
      <p className="text-sm text-stone-500" data-testid="narrative-unavailable">
        No AI narrative has been generated for this report yet.
      </p>
    );
  }

  const sections: { title: string; body: string }[] = [
    { title: "Executive summary", body: narrative.executiveSummary },
    { title: "Micro-location analysis", body: narrative.locationAnalysis },
    { title: "Key pricing drivers", body: narrative.pricingFactors },
    { title: "Confidence rationale", body: narrative.confidenceExplanation },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="narrative-section">
      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="text-sm font-semibold text-stone-900">{section.title}</h3>
          <p className="mt-1 text-sm text-stone-700">{section.body}</p>
        </div>
      ))}
    </div>
  );
}
