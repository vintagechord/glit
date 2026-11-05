// Builds the Onside tab and home-screen icons from one vector mark:
// the yellow brand square with a black border and a black ring ("O"), with
// the site's blue and red accent blocks. Writes
//   src/app/icon.svg        (modern browsers, any size)
//   src/app/favicon.ico     (16, 32 and 48 px PNG entries)
//   src/app/apple-icon.png  (180 px, full bleed for iOS home screens)
// Needs @resvg/resvg-js, which the app does not depend on:
//   npm i --no-save @resvg/resvg-js && node scripts/brand/build-favicons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/app');
const YELLOW = '#f2cf27', INK = '#111111', BLUE = '#1556a4', RED = '#d9362c';

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>ONSIDE</title><rect x="3" y="3" width="58" height="58" rx="9" fill="${YELLOW}" stroke="${INK}" stroke-width="6"/><circle cx="32" cy="32" r="13.5" fill="none" stroke="${INK}" stroke-width="7.5"/><rect x="6" y="6" width="17" height="9" fill="${BLUE}"/><rect x="41" y="49" width="17" height="9" fill="${RED}"/></svg>\n`;
// iOS masks corners itself; transparent corners would show black.
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${INK}"/><rect x="5" y="5" width="54" height="54" fill="${YELLOW}"/><circle cx="32" cy="32" r="12.5" fill="none" stroke="${INK}" stroke-width="7"/><rect x="5" y="5" width="16" height="8" fill="${BLUE}"/><rect x="43" y="51" width="16" height="8" fill="${RED}"/></svg>`;

const png = (svg, size) => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

/** An ICO file whose entries are PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry); header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2); header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

fs.writeFileSync(path.join(app, 'icon.svg'), mark);
fs.writeFileSync(path.join(app, 'favicon.ico'), ico([16, 32, 48].map((size) => ({ size, data: png(mark, size) }))));
fs.writeFileSync(path.join(app, 'apple-icon.png'), png(fullBleed, 180));
console.log('icon.svg, favicon.ico (16/32/48), apple-icon.png (180) written to src/app');
