/**
 * Serves an interactive Swagger UI page, loaded from a CDN rather than an
 * added npm dependency — consistent with this project's general
 * minimal-dependency preference, and appropriate here since this is
 * purely presentational (it just renders whatever /api/openapi.json
 * returns; no server-side logic depends on the Swagger UI package
 * itself). Public, no permission gate, no rate limiting — same reasoning
 * as /api/openapi.json.
 *
 * Returns raw HTML directly (not the JSON envelope, and not through
 * NextResponse.json) — a docs UI page is not a JSON API response.
 */
export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>EPIP API Documentation</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
    />
    <style>
      body { margin: 0; }
      #swagger-ui { max-width: 1400px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/api/openapi.json",
          dom_id: "#swagger-ui",
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
          layout: "BaseLayout",
        });
      };
    </script>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
