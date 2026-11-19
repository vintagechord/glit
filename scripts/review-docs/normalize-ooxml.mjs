// Normalizes the review document templates in place (see
// tools/onside-desk/ooxml-normalize.mjs for what is corrected and why).
// Idempotent. Run after replacing or editing a template:
//   node scripts/review-docs/normalize-ooxml.mjs templates/review-docs/*.docx tools/onside-desk/templates/*.docx
import fs from 'node:fs';
import { normalizeDocxPackage } from '../../tools/onside-desk/ooxml-normalize.mjs';

for (const file of process.argv.slice(2)) {
  const { buffer, changes } = normalizeDocxPackage(fs.readFileSync(file));
  if (!changes.length) { console.log(`${file}: unchanged`); continue; }
  fs.writeFileSync(file, buffer);
  console.log(`${file}: ${[...new Set(changes.map((change) => change.replace(/^word\/[^:]+: /, '')))].join(', ')}`);
}
