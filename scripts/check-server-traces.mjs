#!/usr/bin/env node
// Checks what `next build` decided to ship with each server route. Runs as
// part of `npm run build`, so a deployment that would break the rules below
// fails to build and the version before it stays live.
//
// 1. A route ships only the project files it is known to read at run time.
//    One file read through a path the build could not follow used to pull the
//    whole repository (tests, documents, migrations: ~28 MB a route) into 54
//    of the 243 server routes; nothing reported it.
// 2. Every route that contains the review-document template loader ships
//    every template. A route without them would fail only when an
//    administrator generates documents, which no public check exercises.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Project folders a server route may read at run time. */
export const SHIPPED_PROJECT_PATHS = [
  'public/', // images attached to mails (src/lib/email-attachments.ts)
  'src/assets/fonts/', // receipt PDF and share images
  'templates/review-docs/', // review-document templates
  'services/review-docs/', // the document converter scripts, where Python exists
];
export const TEMPLATE_FOLDER = 'templates/review-docs/';
/** How the template loader reads in built code (src/lib/admin/review-docs.ts). */
export const TEMPLATE_LOADER_MARKER = /"templates",\s*"review-docs"/;

const builtOrInstalled = (file) => file.startsWith('.next/') || file.startsWith('node_modules/');

/**
 * @param {{ route: string, files: string[], hasTemplateLoader: boolean }[]} routes
 *   files are relative to the project root, with forward slashes
 * @param {string[]} templates names of the template files that must ship
 */
export function checkServerTraces(routes, templates) {
  const problems = [];
  for (const { route, files, hasTemplateLoader } of routes) {
    const unexpected = files.filter((file) => !builtOrInstalled(file) && !file.startsWith('..')
      && file !== 'package.json' && !SHIPPED_PROJECT_PATHS.some((allowed) => file.startsWith(allowed)));
    if (unexpected.length) {
      problems.push(`${route} ships ${unexpected.length} project file(s) it should not, e.g. ${unexpected.slice(0, 3).join(', ')}`);
    }
    if (hasTemplateLoader) {
      const shipped = new Set(files.filter((file) => file.startsWith(TEMPLATE_FOLDER)).map((file) => file.slice(TEMPLATE_FOLDER.length)));
      const missing = templates.filter((name) => !shipped.has(name));
      if (missing.length) problems.push(`${route} can generate review documents but ships without ${missing.join(', ')}`);
    }
  }
  if (!routes.some((route) => route.hasTemplateLoader)) {
    problems.push('no route contains the review-document template loader: its marker in the built code has changed (TEMPLATE_LOADER_MARKER)');
  }
  return problems;
}

/** Reads the traces of a finished build. */
export function readServerTraces(root) {
  const server = join(root, '.next', 'server');
  const traces = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.nft.json')) traces.push(path);
    }
  };
  walk(server);
  const loaderInFile = new Map();
  const hasLoader = (file) => {
    if (!loaderInFile.has(file)) {
      loaderInFile.set(file, file.endsWith('.js') && existsSync(file) && TEMPLATE_LOADER_MARKER.test(readFileSync(file, 'utf8')));
    }
    return loaderInFile.get(file);
  };
  return traces.map((trace) => {
    const absolute = (JSON.parse(readFileSync(trace, 'utf8')).files ?? []).map((file) => resolve(dirname(trace), file));
    const entry = trace.slice(0, -'.nft.json'.length);
    return {
      route: relative(server, entry),
      files: absolute.map((file) => relative(root, file).split(sep).join('/')),
      hasTemplateLoader: [entry, ...absolute.filter((file) => file.startsWith(server))].some(hasLoader),
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const templates = readdirSync(join(root, TEMPLATE_FOLDER)).filter((name) => name.endsWith('.docx'));
  const routes = readServerTraces(root);
  const problems = checkServerTraces(routes, templates);
  const withLoader = routes.filter((route) => route.hasTemplateLoader).length;
  if (problems.length) {
    console.error(`Server trace check failed (${problems.length}):`);
    for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
    console.error('See scripts/check-server-traces.mjs for the rules.');
    process.exit(1);
  }
  console.log(`Server trace check passed: ${routes.length} routes, ${withLoader} with the template loader and all ${templates.length} templates.`);
}
