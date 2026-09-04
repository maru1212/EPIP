import type { CategoryStats } from "@/lib/api/types";

const CATEGORY_LABELS: Record<CategoryStats["category"], string> = {
  residential: "Residential",
  commercial: "Commercial",
  land: "Land",
  other: "Other",
};

export function CategoryBreakdownTable({ categories }: { categories: CategoryStats[] }) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-stone-500" data-testid="category-breakdown-empty">
        No active listings in any property-type category for this location yet.
      </p>
    );
  }

  return (
    <table className="w-full text-sm" data-testid="category-breakdown-table">
      <thead>
        <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
          <th className="py-2 font-medium">Category</th>
          <th className="py-2 font-medium">Active listings</th>
          <th className="py-2 text-right font-medium">Median price / m²</th>
        </tr>
      </thead>
      <tbody>
        {categories.map((c) => (
          <tr key={c.category} className="border-b border-stone-100 last:border-0">
            <td className="py-2 font-medium text-stone-900">{CATEGORY_LABELS[c.category]}</td>
            <td className="py-2 text-stone-600">{c.activeListingCount}</td>
            <td className="py-2 text-right text-stone-900">
              {c.medianPricePerSqm !== null
                ? `${Math.round(c.medianPricePerSqm).toLocaleString()} ETB`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
