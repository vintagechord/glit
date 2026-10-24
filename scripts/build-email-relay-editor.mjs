import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve("supabase/functions/send-transactional-email");
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/build-email-relay-editor.mjs /absolute/output.ts");
const handler = await readFile(resolve(directory, "handler.ts"), "utf8");
const transport = (await readFile(resolve(directory, "transport.ts"), "utf8"))
  .replace('import nodemailer from "nodemailer";', 'import nodemailer from "npm:nodemailer@10.2.1";')
  .replace(/^import type .* from "\.\/handler\.ts";\n/m, "");
const entry = (await readFile(resolve(directory, "index.ts"), "utf8"))
  .replace('import addressparser from "nodemailer/lib/addressparser";', 'import addressparser from "npm:nodemailer@10.2.1/lib/addressparser";')
  .replace(/^import \{.*\} from "\.\/(handler|transport)\.ts";\n/gm, "");
await writeFile(output, `// Generated from repository sources; no environment values are embedded.\n${handler}\n${transport}\n${entry}`);
console.log(`Prepared relay editor source: ${output}`);
