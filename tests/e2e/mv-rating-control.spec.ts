import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

let html: string;

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {MvRatingControl} from './src/components/admin/mv-rating-control';
        const query = new URLSearchParams(location.search);
        function App() {
          const [value, setValue] = React.useState(query.get('rating') || '');
          const [notified, setNotified] = React.useState(query.get('notified') === '1');
          React.useEffect(() => {
            const update = event => { setValue(event.detail.value); setNotified(event.detail.notified); };
            window.addEventListener('fixture-rating', update);
            return () => window.removeEventListener('fixture-rating', update);
          }, []);
          return <MvRatingControl submissionId="fixture-mv" initialRating={value} expectedUpdatedAt="2026-10-25T00:00:00Z" isResultNotified={notified}/>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "isolated-navigation",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: "export const useRouter=()=>({refresh(){}});",
          loader: "js",
        }));
      },
    }],
  });
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><main id="root"></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function mount(page: Page, rating: string, notified = false, warning?: string) {
  const requests: Array<{ rating: string }> = [];
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({ contentType: "text/html", body: html });
    } else if (route.request().url().endsWith("/api/admin/submissions/fixture-mv/mv-rating")) {
      const body = route.request().postDataJSON() as { rating: string };
      requests.push(body);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rating: body.rating, warning, deliveredCount: warning ? 0 : 1 }) });
    } else {
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto(`http://mv-rating.test/?${new URLSearchParams({ rating, notified: notified ? "1" : "0" })}`);
  return requests;
}

test("an applicant's desired rating stays separate until an administrator explicitly selects the result", async ({ page }) => {
  const requests = await mount(page, "12세이상관람가");
  await expect(page.getByText("신청 희망등급: 12세이상관람가")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "결과 등급", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "등급 저장", exact: true })).toBeDisabled();
  expect(requests).toEqual([]);

  await page.getByRole("combobox", { name: "결과 등급", exact: true }).selectOption("15");
  await page.getByRole("button", { name: "등급 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("결과 등급을 저장했습니다.");
  expect(requests).toEqual([{ rating: "15", expectedUpdatedAt: "2026-10-25T00:00:00Z" }]);
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "등급 저장", exact: true })).toBeDisabled();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-rating", {
    detail: { value: "15", notified: true },
  })));
  await expect(page.getByText(/신청 희망등급:/)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "결과 등급", exact: true })).toHaveValue("15");
});

test("stored official result codes remain selected without being reclassified as applicant wishes", async ({ page }) => {
  for (const rating of ["ALL", "12", "15", "18", "19", "REJECT"]) {
    await mount(page, rating, true);
    await expect(page.getByRole("combobox", { name: "결과 등급", exact: true })).toHaveValue(rating);
    await expect(page.getByRole("button", { name: "등급 저장", exact: true })).toBeDisabled();
    await expect(page.getByText(/신청 희망등급:/)).toHaveCount(0);
    await page.unrouteAll();
  }
});

test("legacy free-text wishes and new Korean labels cannot be sent as official result codes", async ({ page }) => {
  for (const rating of ["전체관람가", "15세이상관람가", "청소년관람불가", "등급 검토 요청"]) {
    const requests = await mount(page, rating);
    await expect(page.getByText(`신청 희망등급: ${rating}`)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "결과 등급", exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "등급 저장", exact: true })).toBeDisabled();
    expect(requests).toEqual([]);
    await page.unrouteAll();
  }
});


test("saved MV ratings confirm storage and direct the administrator to the separate email control", async ({ page }) => {
  const requests = await mount(page, "", false);
  await page.getByRole("combobox", { name: "결과 등급", exact: true }).selectOption("15");
  await page.getByRole("button", { name: "등급 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("이메일은 결과 안내에서 따로 발송해주세요.");
  expect(requests).toEqual([{ rating: "15", expectedUpdatedAt: "2026-10-25T00:00:00Z" }]);
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "등급 저장", exact: true })).toBeDisabled();
  await expect(page.getByText("저장됨 · 이메일 별도 발송")).toBeVisible();
});
