import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// The client-only English pack as a plain script (imports removed), the same
// way tests/english-language-runtime.test.ts runs it, so its dictionary and
// handlers can run in a vm context without React, Next or a browser.
const source = readFileSync(new URL("../../src/components/i18n/english-language-pack.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("pack.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const runtime = ts.transpileModule(
  sourceFile.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getText(sourceFile).replace(/^export function /, "function "))
    .join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None } },
).outputText;

/** Runs the pack with the given globals, then `setup`, and returns the named top-level declarations. */
export function runEnglishPack<T>(names: string[], globals: Record<string, unknown> = {}, setup = ""): T {
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${runtime}\n${setup}\nglobalThis.__pack = { ${names.join(", ")} };`, context);
  return (context as { __pack: T }).__pack;
}
