import type { ComparableListingDetail } from "@/lib/api/types";

export function ComparablesTable({
  comparables,
}: {
  comparables: ComparableListingDetail[] | undefined;
}) {
  if (!comparables || comparables.length === 0) {
    return (
      <p className="text-sm text-stone-500" data-testid="comparables-empty">
        Per-comparable detail isn&apos;t available for this report — it was generated before this
        data started being recorded, or no comparables were used.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="comparables-table">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-2 pr-4 font-medium">Address</th>
            <th className="py-2 pr-4 font-medium">Size</th>
            <th className="py-2 pr-4 text-right font-medium">Asking price</th>
            <th className="py-2 pr-4 text-right font-medium">Price / m²</th>
            <th className="py-2 text-right font-medium">Distance</th>
          </tr>
        </thead>
        <tbody>
          {comparables.map((c) => (
            <tr key={c.listingId} className="border-b border-stone-100 last:border-0">
              <td className="py-2 pr-4 text-stone-900">
                {c.displayAddress ?? "Address not recorded"}
              </td>
              <td className="py-2 pr-4 text-stone-600">
                {c.areaSqm !== null ? `${c.areaSqm} m²` : "—"}
              </td>
              <td className="py-2 pr-4 text-right text-stone-900">
                {Math.round(c.price).toLocaleString()} ETB
              </td>
              <td className="py-2 pr-4 text-right text-stone-900">
                {c.pricePerSqm !== null
                  ? `${Math.round(c.pricePerSqm).toLocaleString()} ETB`
                  : "—"}
              </td>
              <td className="py-2 text-right text-stone-600">
                {c.distanceMeters !== null
                  ? `${Math.round(c.distanceMeters).toLocaleString()} m`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
