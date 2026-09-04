# Public Property Discovery Portal, Interactive Maps & Valuation UI (Task 11)

Companion to the other domain docs.

## 1. `GET /api/locations` and `GET /api/property-types` — necessary, not scope creep

The spec asks for "Location dropdowns (e.g., Bole, Yeka, Nifas Silk)" and
a property-type filter. Both `LocationNode` and `PropertyType` are
table-driven (deliberately, since Task 2/5), which means there was no
static list the frontend could fall back on — and no endpoint existed to
list them at all. Without these two small, public, read-only endpoints,
the filter panel and the evaluator widget would have nothing real to
populate their dropdowns with, or to send back to the search/evaluate
APIs. Both follow the established public-reference-data pattern (no
permission gate, no rate limiting, standardized envelope).

## 2. Leaflet + OpenStreetMap, not Mapbox GL JS

Mapbox requires a paid API token; none is configured in this environment,
and requiring one would mean the map literally cannot render without
external account setup — the same category of constraint Task 10 faced
with AI providers. Leaflet with OpenStreetMap tiles needs no credentials
at all, consistent with this project's "must work with zero external
configuration" posture throughout.

## 3. A real mismatch between the Overpriced Widget's spec and the backend contract

The spec asks for a form with "select location/subcity, enter area (m²),
asking price (ETB)." `POST /api/analytics/evaluate-listing`'s
direct-parameters mode, however, requires precise `latitude`/`longitude`
plus a `propertyTypeId` (Task 8's own deliberate design — comparable
matching needs an exact point and property type, not a named area or no
type at all). A subcity dropdown alone cannot satisfy that contract.

Resolved by using the selected location's **centroid**, computed
server-side from `LocationNode.boundary` (`ST_Centroid`, exposed via
`GET /api/locations`), as the representative coordinate — and by adding
a property-type selector to the widget beyond the spec's literal field
list, since the API requires it regardless of what the UI mockup implies.

**Important limitation to be aware of**: no real administrative-boundary
polygon data is seeded anywhere in this project (confirmed directly in
`schema.prisma`'s own comment: `LocationNode.boundary` — "Not populated
in Task 2"). This means the widget is wired correctly to the real API
contract and will work the moment real boundary data exists, but in
*this* environment every location's centroid is `null`, and the widget
correctly disables evaluation for any such location with an explanatory
message rather than silently sending garbage coordinates.

## 4. "Bounding box" map search is approximated via radius, not a true rectangle

`GET /api/search/properties` only supports a radius ("near") filter —
extending it to accept a literal rectangular bounds query would be a
backend schema/query change beyond this task's explicit frontend framing.
`src/components/map/mapBounds.ts`'s `boundsToRadiusSearch` approximates
the visible map rectangle as a circle: centered on the bounds' midpoint,
with a radius reaching the farthest corner (the half-diagonal) —
guaranteed to cover the whole visible area, at the cost of also fetching
a modest amount just outside the rectangle's edges near the corners. A
well-understood, common simplification for map-based search UIs, verified
with dedicated tests (covers the full box, scales with box size, handles
a near-zero-area box sensibly) rather than just asserted.

## 5. Property cards show a placeholder image, not a real photo

No property-image upload/storage pipeline exists anywhere in this
project — the `media` module has been scaffolded since Task 1 but never
implemented. Every card renders the same neutral placeholder icon; this
isn't an oversight specific to this task, there is genuinely nothing to
fetch a photo from yet.

## 6. New dependencies: `leaflet`, `react-leaflet`, `@tanstack/react-query`

`leaflet`/`react-leaflet` — no viable way to build genuine interactive
map state (markers, popups, bounds events) via a CDN-only approach the
way Task 9's static Swagger UI page could; a real React integration
library is the appropriate choice for a component this interactive.
`@tanstack/react-query` — the spec explicitly asks for a "query
caching/revalidation strategy"; hand-rolling this would be substantially
more code and more risk than using a well-tested library built for
exactly this purpose. Confirmed via `npm audit` that none of the
reported vulnerabilities in the tree relate to these three new packages —
all are pre-existing in already-pinned Next.js/eslint/Prisma versions
from earlier tasks, unrelated to this change.

## 7. A warmer, more deliberate color palette than the generic Tailwind default

The frontend-design skill explicitly flags "SaaS-card kit" defaults
(identical rounded cards, generic slate-blue accents, the same soft grey
shadow everywhere) as a common AI-generated-page tell. Since this is a
real-estate *utility* portal (function over marketing flourish), a full
brand-identity exercise wasn't proportionate — but the initial
slate/blue palette was swapped for a warmer stone/terracotta one
(explicit hex values, not a generic Tailwind "blue-500") across every
component, as a deliberate, if modest, choice reflecting the subject
matter rather than a default.

## 8. The gauge is a horizontal spectrum, not a literal speedometer dial

"Visual Market Indicator: Render a dynamic gauge/meter" is satisfied with
a colored dot positioned along an underpriced-to-overpriced horizontal
track, rather than an SVG circular dial. Communicates the same
at-a-glance "where does this fall" information with far less markup
complexity, and reads clearly without needing rotation math.
