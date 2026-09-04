# search module

Combined filter/geo query building over Property and Listing, plus B2B
market-data aggregation.

Implemented (Task 8):
- `services/searchService.ts` — aggregated public discovery search
  (`GET /api/search/properties`), composing `listingRepository.
  searchWithPropertyDetails` with `listingService.calculatePricePerSqm`.
- `repositories/marketDataRepository.ts` + `services/marketDataService.ts`
  — B2B neighborhood/subcity statistics, aggregating over a LocationNode
  and every descendant beneath it via a recursive CTE (so querying a
  subcity includes its neighborhoods).

See `docs/search-and-b2b-domain.md` for decisions and flagged
trade-offs. No `PriceHistory`-based true historical trends yet — current
active-listing price range only.
