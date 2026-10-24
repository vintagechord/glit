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
  await page.route("**/dashboard/new?*", async (route) => {
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
  await navigation.getByRole("link", { name: "심의 신청", exact: true }).click();
  releaseResponse();
  await expect(page).toHaveURL(/\/dashboard\/new$/);
  await expect(page.getByRole("heading", { name: "무엇을 신청하시나요?", exact: true })).toBeVisible();
  expect(delayedRequests).toBeGreaterThan(0);
  expect(documentRequests).toEqual([]);
});

test("the chat launcher stays mounted when moving between public pages", async ({ page }) => {
  await page.goto("/");
  const launcher = page.getByRole("button", { name: "실시간 채팅 열기", exact: true });
  await expect(launcher).toBeVisible();
  await launcher.evaluate((element) => { element.setAttribute("data-qa-existing-launcher", "true"); });
  const footer=page.locator('footer');
  await footer.locator('summary').filter({hasText:'사이트 링크'}).click();
  await footer.getByRole('link',{name:'고객센터',exact:true}).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByRole("heading", { name: "어떻게 도와드릴까요?", exact: true })).toBeVisible();
  await expect(launcher).toHaveAttribute("data-qa-existing-launcher", "true");
});

test("application navigation hides the chat launcher without a document reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "실시간 채팅 열기", exact: true })).toBeVisible();
  const documents: string[]=[];
  page.on("request",request=>{if(request.isNavigationRequest()&&request.resourceType()==="document")documents.push(request.url())});
  await page.getByRole("navigation", { name: "주요 메뉴", exact: true }).getByRole("link", { name: "심의 신청", exact: true }).click();
  await expect(page.getByRole("heading", { name: "무엇을 신청하시나요?", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "실시간 채팅 열기", exact: true })).toHaveCount(0);
  expect(documents).toEqual([]);
});
