import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runEnglishPack } from "./fixtures/english-pack-runtime";

// A DOM anchor reduced to what the pack's link code reads.
class Anchor {
  constructor(private readonly attributes: Record<string, string>) {}
  getAttribute(name: string) { return name in this.attributes ? this.attributes[name] : null; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  hasAttribute(name: string) { return name in this.attributes; }
  matches(selector: string) {
    return selector.split(",").some((part) => {
      const trimmed = part.trim();
      if (trimmed === "a[href]") return this.hasAttribute("href");
      const attribute = /^\[([\w-]+)\]$/.exec(trimmed);
      if (attribute) return this.hasAttribute(attribute[1]);
      throw new Error(`unsupported selector ${trimmed}`);
    });
  }
  closest(selector: string) { return this.matches(selector) ? this : null; }
  querySelectorAll() { return []; }
}

type Pack = {
  handleDocumentClick: (event: unknown) => void;
  localizeLink: (link: Anchor) => void;
};

function englishPage() {
  const assigned: string[] = [];
  const window = { location: { origin: "https://iamonside.test", pathname: "/en/faq", assign: (url: string) => assigned.push(url) } };
  // localizeLink rewrites at once, as on a hydrated page. An anchor not yet
  // passed to it stands for one the pack has not rewritten (before hydration).
  const pack = runEnglishPack<Pack>(["handleDocumentClick", "localizeLink"], { window, URL }, "hydrationSettled = true;");
  const click = (anchor: Anchor, modifiers: { metaKey?: boolean } = {}) => {
    const event = {
      target: anchor, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...modifiers,
      preventDefault() { this.defaultPrevented = true; },
    };
    pack.handleDocumentClick(event);
    return event.defaultPrevented;
  };
  return { pack, assigned, click };
}

test("a plain next/link the pack rewrote to /en navigates to the English page, not its Korean href prop", () => {
  const { pack, assigned, click } = englishPage();
  // <Link href="/dashboard/new"> on /en/faq: the DOM shows /en/dashboard/new,
  // but next/link would push its Korean prop unless the click is taken over.
  const apply = new Anchor({ href: "/dashboard/new" });
  pack.localizeLink(apply);
  assert.equal(apply.getAttribute("href"), "/en/dashboard/new");
  assert.equal(click(apply), true, "preventDefault stops next/link (it checks e.defaultPrevented)");
  assert.deepEqual(assigned, ["/en/dashboard/new"]);

  const footerGuide = new Anchor({ href: "/guide/pricing#packages" });
  pack.localizeLink(footerGuide);
  assert.equal(click(footerGuide), true);
  assert.equal(assigned.at(-1), "/en/guide/pricing#packages");
});

test("links that are already English, opted out, opened in a new tab or modified are left alone", () => {
  const { pack, assigned, click } = englishPage();
  const reliable = new Anchor({ href: "/en/faq" });
  pack.localizeLink(reliable);
  assert.equal(click(reliable), false, "a ReliableLink already carries the English href; next/link navigates client-side");
  const languageSwitch = new Anchor({ href: "/faq", "data-no-localize": "true" });
  pack.localizeLink(languageSwitch);
  assert.equal(languageSwitch.getAttribute("href"), "/faq");
  assert.equal(click(languageSwitch), false);
  const newTab = new Anchor({ href: "/mypage/submissions/1", target: "_blank" });
  assert.equal(click(newTab), false, "before hydration a new-tab link must not turn into a same-tab navigation");
  pack.localizeLink(newTab);
  assert.equal(newTab.getAttribute("href"), "/en/mypage/submissions/1", "the new tab opens the English page");
  assert.equal(click(newTab), false);
  const rewritten = new Anchor({ href: "/support" });
  pack.localizeLink(rewritten);
  assert.equal(click(rewritten, { metaKey: true }), false, "a modified click opens the rewritten href in a new tab");
  assert.deepEqual(assigned, []);
});

test("file downloads keep their real address on English pages", () => {
  const { pack, assigned, click } = englishPage();
  // The application form downloads in the album and MV wizards.
  for (const href of ["/forms/Onside_music_application_hangul_form.hwp", "/forms/Onside_MVapplication_word_form.doc"]) {
    const download = new Anchor({ href, download: href.split("/").pop()! });
    assert.equal(click(download), false, `${href} downloads before hydration`);
    pack.localizeLink(download);
    assert.equal(download.getAttribute("href"), href, "there is no /en/forms file to download");
    assert.equal(click(download), false, `${href} downloads after hydration`);
  }
  assert.deepEqual(assigned, []);
  // The forms page itself still has an English twin.
  const formsPage = new Anchor({ href: "/forms" });
  pack.localizeLink(formsPage);
  assert.equal(formsPage.getAttribute("href"), "/en/forms");
});

test("English FAQ, guide, trust-fact and footer links carry the English href themselves", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  for (const file of [
    "src/app/faq/page.tsx",
    "src/app/guide/page.tsx",
    "src/app/guide/[slug]/page.tsx",
    "src/app/guide/pricing/page.tsx",
    "src/app/guide/stations/page.tsx",
    "src/app/guide/stations/[station]/page.tsx",
    "src/app/guide/glossary/page.tsx",
    "src/components/guide/trust-facts.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /from "next\/link"/, `${file} uses next/link, which navigates to its Korean href on /en pages`);
    assert.match(source, /import \{ ReliableLink as Link \} from "@\/components\/site\/reliable-link";/, file);
  }
  const footer = read("src/components/site/footer.tsx");
  assert.match(footer, /href=\{`\$\{siteLinkPrefix\}\/guide\/\$\{guide\.slug\}`\}/);
  assert.match(footer, /href=\{`\$\{siteLinkPrefix\}\$\{topic\.path\}`\}/);
});
