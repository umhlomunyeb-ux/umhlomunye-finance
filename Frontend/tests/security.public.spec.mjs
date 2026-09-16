import { test, expect } from "@playwright/test";

const protectedRoutes = [
  "/dashboard",
  "/customers",
  "/loans",
  "/repayments",
  "/statements",
  "/reports",
  "/settings",
  "/documents",
  "/applications",
  "/bank",
  "/pending-applications",
];

test.describe("Unauthenticated route protection", () => {
  for (const route of protectedRoutes) {
    test(`${route} requires authentication`, async ({
      page,
    }) => {
      await page.goto(route);

      await expect(page).toHaveURL(/\/$/);
    });
  }
});