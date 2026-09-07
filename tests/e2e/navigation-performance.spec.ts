import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // These checks only navigate public pages; never create submissions or chats.
  await page.route("**/*", async (route) => {
    if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      await route.continue();
    } else {
      await route.fulfill({ status: 409, json: { error: "Unexpected mutation blocked." } });
    }
  });
});

test("a slow menu transition finishes without restarting the document", async ({ page }) => {
  let releaseResponse!: () => void;
  const clicked = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let delayedRequests = 0;
  await page.route("**/magazine?*", async (route) => {
    if (route.request().headers().rsc !== "1") return route.fallback();
    delayedRequests += 1;
    await clicked;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });

  await page.goto("/");
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.resourceType() === "document") {
      documentRequests.push(new URL(request.url()).pathname);
    }
  });
  const navigation = page.getByRole("navigation", { name: "주요 메뉴", exact: true });
  await navigation.getByRole("link", { name: "크레딧", exact: true }).click();
  releaseResponse();
  await expect(page).toHaveURL(/\/magazine$/);
  await expect(page.getByRole("heading", { name: "앨범심의 결제 완료 1건당 크레딧 1개가 지급됩니다." })).toBeVisible();
  expect(delayedRequests).toBeGreaterThan(0);
  expect(documentRequests).toEqual([]);
});

test("the chat launcher stays mounted when moving between public pages", async ({ page }) => {
  await page.goto("/");
  const launcher = page.getByRole("button", { name: "실시간 채팅 열기", exact: true });
  await expect(launcher).toBeVisible();
  await launcher.evaluate((element) => { element.setAttribute("data-qa-existing-launcher", "true"); });
  await page.getByRole("navigation", { name: "주요 메뉴", exact: true })
    .getByRole("link", { name: "심의 신청", exact: true }).click();
  await expect(page.getByRole("heading", { name: "무엇을 신청하시나요?" })).toBeVisible();
  await expect(launcher).toHaveAttribute("data-qa-existing-launcher", "true");
});
