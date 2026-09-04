import { test, expect } from "@playwright/test";

test("homepage renders the platform heading", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /ethiopian property intelligence platform/i })
  ).toBeVisible();
});
