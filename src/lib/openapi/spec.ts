/**
 * Code-first OpenAPI 3.0 specification for the entire EPIP API surface.
 *
 * A note on accuracy: this project's real authentication mechanism is an
 * httpOnly session cookie set by Auth.js (next-auth) after login — not a
 * client-presented `Authorization: Bearer <token>` header. The Task 9
 * spec explicitly asked for protected endpoints to be documented as
 * requiring "Bearer JWT authentication," so that's what the
 * `bearerAuth` security scheme below describes. This is a deliberate
 * simplification for documentation purposes, flagged here and in
 * docs/api-standardization.md — a strictly accurate spec would use an
 * `apiKey`-type scheme with `in: cookie` instead. Worth revisiting if
 * this spec is ever used to generate a real API client, since a
 * generated client would try to send a Bearer header that this API
 * doesn't actually check.
 *
 * Response envelope note: `/api/openapi.json` itself and this spec's
 * examples reflect the Task 9 standardized envelope
 * (`{ success, data, meta }` / `{ success, error }`), which covers every
 * route documented here — Property, Listing, and Valuation routes were
 * retrofitted to it in this same task; Search/Analytics/B2B routes
 * (Task 8) already used it.
 *
 * Deliberately not exhaustive at the field level for every nested object
 * (e.g. a Property's full field list) — this documents every real route,
 * method, parameter, security requirement, and status code in the
 * application, with representative request/response shapes, rather than
 * a byte-for-byte schema of every domain type. See
 * docs/api-standardization.md for what's covered vs. simplified.
 */

const SUCCESS_ENVELOPE = {
  type: "object",
  properties: {
    success: { type: "boolean", enum: [true] },
    data: {},
    meta: {
      type: "object",
      properties: {
        pagination: {
          type: "object",
          properties: {
            limit: { type: "integer" },
            offset: { type: "integer" },
            count: { type: "integer" },
          },
        },
      },
    },
  },
  required: ["success", "data"],
};

const ERROR_ENVELOPE = {
  type: "object",
  properties: {
    success: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
      required: ["code", "message"],
    },
  },
  required: ["success", "error"],
};

function errorResponseRef(description: string) {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
  };
}

const STANDARD_ERRORS = {
  "400": errorResponseRef("Validation error — one or more fields/parameters are invalid."),
  "401": errorResponseRef("No valid session — sign-in required."),
  "403": errorResponseRef(
    "Authenticated, but lacking the required permission, or not the resource's owner."
  ),
  "404": errorResponseRef("The requested resource does not exist."),
  "429": errorResponseRef("Rate limit exceeded — see the Retry-After header."),
};

function successResponseRef(description: string, dataExample?: unknown) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SuccessEnvelope" },
        ...(dataExample !== undefined ? { example: { success: true, data: dataExample } } : {}),
      },
    },
  };
}

const idParam = {
  name: "id",
  in: "path" as const,
  required: true,
  schema: { type: "string", format: "uuid" },
};

const bearerSecurity = [{ bearerAuth: [] as string[] }];

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Ethiopian Property Intelligence Platform (EPIP) API",
    version: "1.0.0",
    description:
      "Property marketplace, market-intelligence, and B2B data API for the Ethiopian Property Intelligence Platform. " +
      "Most endpoints are public and unauthenticated (property/listing search and detail, valuation estimation); " +
      "mutation and B2B endpoints require an authenticated session with the relevant RBAC permission.",
  },
  servers: [{ url: "/", description: "Relative to this deployment" }],
  tags: [
    { name: "Auth", description: "Registration and session management" },
    { name: "Properties", description: "Canonical physical-asset records" },
    { name: "Listings", description: "Commercial offers against a Property" },
    { name: "Valuations", description: "Automated comparable-sales valuation" },
    { name: "Search", description: "Aggregated public discovery search" },
    { name: "Analytics", description: "Public price-evaluation widgets" },
    { name: "B2B", description: "Institutional/B2B market-data endpoints (Task 8 scaffolding)" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Documented as a Bearer JWT per convention; this API's actual session mechanism is an httpOnly cookie set by Auth.js after login, not a client-presented Authorization header. See the top-of-file note in src/lib/openapi/spec.ts.",
      },
    },
    schemas: {
      SuccessEnvelope: SUCCESS_ENVELOPE,
      ErrorEnvelope: ERROR_ENVELOPE,
    },
  },
  paths: {
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new account",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password", "fullName"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                  fullName: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Account created." },
          "400": errorResponseRef("Validation error."),
          "409": errorResponseRef("An account with this email already exists."),
          "429": errorResponseRef("Rate limit exceeded (per-email and per-IP)."),
        },
      },
    },
    "/api/properties": {
      get: {
        tags: ["Properties"],
        summary: "Search published properties",
        security: [],
        parameters: [
          { name: "locationNodeId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "propertyTypeId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "minBedrooms", in: "query", schema: { type: "integer" } },
          { name: "maxBedrooms", in: "query", schema: { type: "integer" } },
          { name: "minBuildingAreaSqm", in: "query", schema: { type: "number" } },
          { name: "maxBuildingAreaSqm", in: "query", schema: { type: "number" } },
          { name: "latitude", in: "query", schema: { type: "number" } },
          { name: "longitude", in: "query", schema: { type: "number" } },
          { name: "radiusMeters", in: "query", schema: { type: "number" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: {
          "200": successResponseRef("A page of matching published properties."),
          "400": STANDARD_ERRORS["400"],
        },
      },
      post: {
        tags: ["Properties"],
        summary: "Create a property record",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["locationNodeId", "propertyTypeId"],
                properties: {
                  locationNodeId: { type: "string", format: "uuid" },
                  propertyTypeId: { type: "string", format: "uuid" },
                  coordinates: {
                    type: "object",
                    properties: {
                      latitude: { type: "number" },
                      longitude: { type: "number" },
                    },
                  },
                  bedrooms: { type: "integer" },
                  bathrooms: { type: "integer" },
                  buildingAreaSqm: { type: "number" },
                  landAreaSqm: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "201": successResponseRef("The newly created property (status: draft)."),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
        },
      },
    },
    "/api/properties/{id}": {
      get: {
        tags: ["Properties"],
        summary: "Get a published property by ID",
        security: [],
        parameters: [idParam],
        responses: {
          "200": successResponseRef("The property."),
          "404": STANDARD_ERRORS["404"],
        },
      },
      patch: {
        tags: ["Properties"],
        summary: "Update a property's details (owner or admin only)",
        security: bearerSecurity,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": successResponseRef("The updated property."),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
        },
      },
      delete: {
        tags: ["Properties"],
        summary: "Archive a property (soft-delete; owner or admin only)",
        security: bearerSecurity,
        parameters: [idParam],
        responses: {
          "200": successResponseRef("The archived property."),
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
        },
      },
    },
    "/api/properties/{id}/status": {
      patch: {
        tags: ["Properties"],
        summary: "Transition a property's publication status (draft/published/archived)",
        security: bearerSecurity,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["publicationStatus"],
                properties: {
                  publicationStatus: { type: "string", enum: ["draft", "published", "archived"] },
                },
              },
            },
          },
        },
        responses: {
          "200": successResponseRef("The property with its new status."),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
        },
      },
    },
    "/api/listings": {
      get: {
        tags: ["Listings"],
        summary: "Search active listings on published properties",
        security: [],
        parameters: [
          { name: "listingType", in: "query", schema: { type: "string", enum: ["sale", "rent"] } },
          { name: "minPrice", in: "query", schema: { type: "number" } },
          { name: "maxPrice", in: "query", schema: { type: "number" } },
          { name: "locationNodeId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: {
          "200": successResponseRef("A page of matching active listings."),
          "400": STANDARD_ERRORS["400"],
        },
      },
      post: {
        tags: ["Listings"],
        summary: "Create a listing against an existing property",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["propertyId", "listingType", "price"],
                properties: {
                  propertyId: { type: "string", format: "uuid" },
                  listingType: { type: "string", enum: ["sale", "rent"] },
                  price: { type: "number" },
                  currency: { type: "string", enum: ["ETB", "USD"] },
                  negotiable: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "201": successResponseRef("The newly created listing (status: draft)."),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": errorResponseRef("The target property does not exist."),
        },
      },
    },
    "/api/listings/{id}": {
      get: {
        tags: ["Listings"],
        summary: "Get an active listing by ID, including computed price-per-sqm",
        security: [],
        parameters: [idParam],
        responses: {
          "200": successResponseRef("The listing and its computed pricePerSqm."),
          "404": STANDARD_ERRORS["404"],
        },
      },
      patch: {
        tags: ["Listings"],
        summary: "Update a listing's price/currency/contact info (agent or admin only)",
        security: bearerSecurity,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": successResponseRef("The updated listing."),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
        },
      },
      delete: {
        tags: ["Listings"],
        summary: "Archive a listing (soft-delete; agent or admin only)",
        security: bearerSecurity,
        parameters: [idParam],
        responses: {
          "200": successResponseRef("The archived listing."),
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
        },
      },
    },
    "/api/listings/{id}/status": {
      patch: {
        tags: ["Listings"],
        summary: "Transition a listing's status (draft/active/sold/rented/expired/archived)",
        security: bearerSecurity,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: {
                    type: "string",
                    enum: ["draft", "active", "sold", "rented", "expired", "archived"],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": successResponseRef("The listing with its new status."),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
          "409": errorResponseRef("The requested status transition is not allowed from the current status."),
        },
      },
    },
    "/api/valuations/estimate": {
      post: {
        tags: ["Valuations"],
        summary: "Generate an automated comparable-sales valuation estimate for a property",
        description:
          "Public and rate-limited, not permission-gated. Anonymous requests are supported; if a session " +
          "exists, the resulting report records who requested it. Returns `persisted: false` (HTTP 200, not " +
          "an error) rather than a fabricated number when there is no usable comparable market data.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["propertyId"],
                properties: { propertyId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
        responses: {
          "201": successResponseRef("A persisted valuation report was generated."),
          "200": successResponseRef("Insufficient comparable data — no report was persisted."),
          "400": STANDARD_ERRORS["400"],
          "404": STANDARD_ERRORS["404"],
          "422": errorResponseRef("The property has no usable building or land area to value by."),
          "429": STANDARD_ERRORS["429"],
        },
      },
    },
    "/api/valuations/analyze-listing": {
      post: {
        tags: ["Valuations"],
        summary: "Assess whether an asking price is overpriced, fair, or underpriced",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["propertyId", "askingPrice"],
                properties: {
                  propertyId: { type: "string", format: "uuid" },
                  askingPrice: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "200": successResponseRef("The price assessment, or an insufficient-data result."),
          "400": STANDARD_ERRORS["400"],
          "404": STANDARD_ERRORS["404"],
          "422": errorResponseRef("The property has no usable building or land area to value by."),
          "429": STANDARD_ERRORS["429"],
        },
      },
    },
    "/api/valuations/{id}": {
      get: {
        tags: ["Valuations"],
        summary: "Fetch a saved valuation report",
        description:
          "Unlike Property/Listing GETs, this is permission-gated (valuation:view) — a saved report is " +
          "closer to a personal query result than a public listing. Ownership (the report's requester, or " +
          "an admin override) is additionally enforced.",
        security: bearerSecurity,
        parameters: [idParam],
        responses: {
          "200": successResponseRef("The valuation report."),
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
        },
      },
    },
    "/api/valuations/ai-report": {
      post: {
        tags: ["Valuations"],
        summary: "Generate an AI-enriched narrative valuation report (Task 10)",
        description:
          "Gated behind valuation:create — a heavier, costlier operation than the free statistical " +
          "estimate. Always falls back gracefully to the plain statistical report with aiEnriched: false " +
          "if the AI provider fails, times out, or returns a malformed response; never a 500 for an " +
          "AI-layer failure.",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["propertyId"],
                properties: { propertyId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
        responses: {
          "201": successResponseRef("A persisted, AI-enriched valuation report (aiEnriched: true)."),
          "200": successResponseRef(
            "A persisted statistical report with aiEnriched: false (AI enrichment failed and fell back), " +
              "or an insufficient-data result."
          ),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
          "422": errorResponseRef("The property has no usable building or land area to value by."),
          "429": STANDARD_ERRORS["429"],
        },
      },
    },
    "/api/valuations/{id}/ai-summary": {
      get: {
        tags: ["Valuations"],
        summary: "Retrieve the cached AI narrative for a valuation report (Task 10)",
        description:
          "Never triggers a new AI call — reads whatever narrative (if any) was already persisted. " +
          "Returns 200 with aiEnriched: false (not 404) when the report exists but has no AI narrative yet.",
        security: bearerSecurity,
        parameters: [idParam],
        responses: {
          "200": successResponseRef("The cached narrative, or aiEnriched: false if none exists."),
          "401": STANDARD_ERRORS["401"],
          "403": STANDARD_ERRORS["403"],
          "404": STANDARD_ERRORS["404"],
        },
      },
    },
    "/api/search/properties": {
      get: {
        tags: ["Search"],
        summary: "Aggregated discovery search across Property and Listing, with computed price-per-sqm",
        security: [],
        parameters: [
          { name: "locationNodeId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "propertyType", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "minPrice", in: "query", schema: { type: "number" } },
          { name: "maxPrice", in: "query", schema: { type: "number" } },
          { name: "listingType", in: "query", schema: { type: "string", enum: ["sale", "rent"] } },
          { name: "minBedrooms", in: "query", schema: { type: "integer" } },
          { name: "minBathrooms", in: "query", schema: { type: "integer" } },
          { name: "minBuildingSize", in: "query", schema: { type: "number" } },
          { name: "latitude", in: "query", schema: { type: "number" } },
          { name: "longitude", in: "query", schema: { type: "number" } },
          { name: "radiusMeters", in: "query", schema: { type: "number" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: {
          "200": successResponseRef("A page of matching properties with listing price and pricePerSqm."),
          "400": STANDARD_ERRORS["400"],
        },
      },
    },
    "/api/analytics/evaluate-listing": {
      post: {
        tags: ["Analytics"],
        summary: "Public overpriced/fair/underpriced widget — propertyId, listingId, or direct parameters",
        description:
          "Exactly one of `propertyId`, `listingId`, or the direct-parameter set " +
          "(latitude, longitude, buildingSize, propertyTypeId, askingPrice) must be provided. " +
          "Strictly rate-limited per-IP against automated scraping.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  propertyId: { type: "string", format: "uuid" },
                  listingId: { type: "string", format: "uuid" },
                  askingPrice: { type: "number" },
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                  buildingSize: { type: "number" },
                  propertyTypeId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "200": successResponseRef("The price assessment, or an insufficient-data result."),
          "400": STANDARD_ERRORS["400"],
          "404": STANDARD_ERRORS["404"],
          "422": errorResponseRef("The target has no usable building or land area to value by."),
          "429": STANDARD_ERRORS["429"],
        },
      },
    },
    "/api/v1/b2b/properties/{id}/valuation-summary": {
      get: {
        tags: ["B2B"],
        summary: "Property metadata plus its most recent valuation report (institutional)",
        security: bearerSecurity,
        parameters: [idParam],
        responses: {
          "200": successResponseRef("Property summary and latest valuation (or null if none exists)."),
          "401": STANDARD_ERRORS["401"],
          "403": errorResponseRef("Missing the market_data:read permission."),
          "404": STANDARD_ERRORS["404"],
        },
      },
    },
    "/api/v1/b2b/market-data/neighborhood-stats": {
      get: {
        tags: ["B2B"],
        summary: "Aggregated market statistics for a LocationNode and everything beneath it",
        description:
          "Aggregates over the given LocationNode and every descendant in the hierarchy — querying a " +
          "subcity like Bole includes every neighborhood beneath it.",
        security: bearerSecurity,
        parameters: [
          {
            name: "locationNodeId",
            in: "query",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": successResponseRef(
            "Median price, median price/sqm, active listing count, and current price range."
          ),
          "400": STANDARD_ERRORS["400"],
          "401": STANDARD_ERRORS["401"],
          "403": errorResponseRef("Missing the market_data:read permission."),
          "404": STANDARD_ERRORS["404"],
        },
      },
    },
  },
} as const;
