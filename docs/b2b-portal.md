# B2B Banking & Valuer Intelligence Portal UI (Task 12)

Companion to the other domain docs.

## 1. Neighborhood stats had no property-type breakdown — added a real one

The dashboard spec asks for price/m² compared across Residential/
Commercial/Land. The existing `neighborhood-stats` endpoint (Task 8)
aggregated across all property types at once. Extended
`marketDataRepository.getCategoryBreakdown` with a `CASE` expression over
`property_types.key` (apartment/house/villa -> residential, commercial/
office -> commercial, land -> land, everything else -> other) rather than
a schema change — `PropertyType` stays table-driven (Task 5) with no new
"category" column. Verified against the live database with genuinely
mixed data: an apartment and a commercial property in the same location
correctly separated into distinct groups with their own median price/m².

## 2. No historical trend data exists — the UI says so plainly

`PriceHistory` was explicitly deferred back in Task 8's own docs
(`docs/search-and-b2b-domain.md` §6). Rather than fabricating an up/down
arrow, `NeighborhoodStats.trendDirection` is always `"unavailable"`, and
the dashboard's metric card literally reads "Unavailable — Price-history
tracking isn't collected yet." Consistent with this project's repeated
principle (Task 7's zero-comparable case, Task 8's "current snapshot, not
history") of never inventing a number to fill a UI slot.

## 3. Valuation reports didn't persist comparable-listing details — now they do, going forward

The report viewer's "Comparable Listings Data Table" needs address,
size, price, price/m², and distance per comparable. Before this task,
`valuationData` only stored `comparableListingIds` (bare UUIDs) — no
detail to render at all. Extended `ComparableListing`/
`findComparableListings` with `displayAddress`, and extended
`valuationService.estimateValue` to persist a `comparables` array with
full display detail at report-creation time. This only affects reports
created from this point forward — a report created before Task 12 will
correctly show "per-comparable detail isn't available for this report"
rather than crashing or fabricating rows. Verified against the live
database that `display_address` (nullable — many properties never have
one recorded) flows through correctly.

## 4. The "manual details" valuation path creates a draft Property first

Neither `/api/valuations/estimate` nor `/api/valuations/ai-report`
accept raw manual property details — both require an existing
`propertyId` (Tasks 7/10's deliberate design: a valuation is always "of"
a saved `Property`). Rather than adding a new "value from scratch"
endpoint, the manual-entry path in the request form calls the existing
`POST /api/properties` (Task 5) first, then values the property that was
just created. This is a real, load-bearing consequence worth being
explicit about: **the manual-entry path requires `property:create` in
addition to `valuation:create`** — a valuer/bank account with only
`valuation:create` can use the "existing property ID" path but not
"manual details." The form surfaces this in its own copy rather than
letting it fail silently or confusingly.

## 5. RBAC is enforced by the backend, not re-implemented in these pages

All three new pages call already-gated backend endpoints
(`market_data:read`, `valuation:view`, `valuation:create` — Tasks 8/10)
and interpret the resulting 401/403 into a clean `UnauthorizedFallback`
component. No page attempts its own permission check client-side — that
would be both redundant and a genuine security risk if the frontend's
copy of the policy ever drifted from the backend's real one. The one
exception worth noting: the manual-entry form's property-creation step
can fail with its own separate 403 if the account lacks `property:create`
specifically (see §4) — the same fallback component handles that case
too, since it only inspects the HTTP status, not which specific
permission was missing.

## 6. The confidence gauge and category-breakdown table are plain HTML/CSS, not a charting library

Given the existing project pattern (Task 11's evaluator widget used a
CSS-positioned dot on a gradient bar, not a canvas/SVG gauge library),
the confidence rating gauge here follows the same approach: a
percentage-width fill bar with `role="progressbar"` for accessibility.
The category comparison is a plain HTML table, not a chart — a 3-4 row
comparison table reads faster than a bar chart at this scale, and avoids
a new charting dependency for a comparison this simple.
