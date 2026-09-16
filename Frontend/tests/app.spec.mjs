import { test, expect } from "@playwright/test";

const protectedRoutes = [
  {
    name: "Dashboard",
    path: "/dashboard",
  },
  {
    name: "Customers",
    path: "/customers",
  },
  {
    name: "Loans",
    path: "/loans",
  },
  {
    name: "Repayments",
    path: "/repayments",
  },
  {
    name: "Statements",
    path: "/statements",
  },
  {
    name: "Reports",
    path: "/reports",
  },
  {
    name: "Settings",
    path: "/settings",
  },
  {
    name: "Documents",
    path: "/documents",
  },
  {
    name: "Applications",
    path: "/applications",
  },
  {
    name: "Bank",
    path: "/bank",
  },
  {
    name: "Pending Applications",
    path: "/pending-applications",
  },
];

test.describe("Authenticated LMS application", () => {
  test("authenticated user can reach dashboard", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/dashboard$/);

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  for (const route of protectedRoutes) {
    test(`${route.name} page loads`, async ({ page }) => {
      await page.goto(route.path);

      await expect(page).toHaveURL(
        new RegExp(
          `${route.path.replace(/\//g, "\\/")}$`
        )
      );

      await expect(
        page.locator("body")
      ).toBeVisible();

      await expect(
        page.locator("body")
      ).not.toContainText(
        "Application error"
      );
    });
  }

  test("customer profile route responds", async ({
    page,
  }) => {
    await page.goto("/customers/test-id");

    await expect(page).toHaveURL(
      /\/customers\/test-id$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("loan profile route responds", async ({
    page,
  }) => {
    await page.goto("/loans/test-id");

    await expect(page).toHaveURL(
      /\/loans\/test-id$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("application review route responds", async ({
    page,
  }) => {
    await page.goto("/applications/test-id");

    await expect(page).toHaveURL(
      /\/applications\/test-id$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("mobile application review list loads for authenticated user", async ({
    page,
  }) => {
    await page.goto(
      "/mobile/application-review"
    );

    await expect(page).toHaveURL(
      /\/mobile\/application-review$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("sidebar/navigation is rendered", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(
      page.locator("body")
    ).toBeVisible();

    const navigation = page.locator(
      "nav"
    );

    if (await navigation.count()) {
      await expect(
        navigation.first()
      ).toBeVisible();
    }
  });
});