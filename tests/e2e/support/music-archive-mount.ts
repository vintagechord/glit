import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const artifacts = new Map<string, Promise<string>>();
/** Mount the actual production client only in a browser-intercepted test document.
 * No auth bypass, public fixture route, database write, or external provider call.
 * Next's server/proxy contract is verified separately; these are mocked UI tests.
 */
export function archiveClientDocument(modulePath: string, exportName: string) {
  const key = `${modulePath}:${exportName}`;
  if (!artifacts.has(key)) artifacts.set(key, (async () => {
    const [bundle, css] = await Promise.all([
      build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {${exportName}} from '${modulePath}'; createRoot(document.getElementById('root')).render(React.createElement(${exportName}));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"production"}' }, minify: true }),
      readFile(resolve("src/app/globals.css"), "utf8").then((css) => postcss([tailwind()]).process(css, { from: resolve("src/app/globals.css") })),
    ]);
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  })());
  return artifacts.get(key)!;
}
