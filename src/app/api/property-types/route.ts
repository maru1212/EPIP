import { successResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";
import { prisma } from "@/lib/db";

/**
 * Task 11: same reasoning as GET /api/locations — the Property Search
 * UI's property-type dropdown and the Overpriced Evaluator Widget both
 * need real PropertyType ids (Task 5 made this table-driven, not an
 * enum, specifically so it's extensible — but that also means the
 * frontend has no static list to fall back on). Public reference data,
 * no permission gate, no rate limiting.
 *
 * Simple enough (one small, un-parameterized query, no filtering) that a
 * dedicated repository/service layer would be pure ceremony — kept as a
 * direct, narrow raw-SQL call in the route itself, consistent with how
 * this project treats genuinely trivial reference-data reads.
 */
export async function GET() {
  try {
    const propertyTypes = (await prisma.$queryRawUnsafe(
      `SELECT id, key, label, label_amharic, is_active
       FROM property_types
       WHERE is_active = true
       ORDER BY label ASC`
    )) as {
      id: string;
      key: string;
      label: string;
      label_amharic: string | null;
      is_active: boolean;
    }[];

    return successResponse(
      propertyTypes.map((row) => ({
        id: row.id,
        key: row.key,
        label: row.label,
        labelAmharic: row.label_amharic,
      }))
    );
  } catch (error) {
    return handleUnexpectedError(error, "GET /api/property-types");
  }
}
