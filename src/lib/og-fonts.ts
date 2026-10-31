import { readFile } from "node:fs/promises";
import path from "node:path";

/** Korean font for build-time images (Open Graph, logo). */
export const loadOgFont = () =>
  readFile(path.join(process.cwd(), "src/assets/fonts/nanum-gothic/NanumGothic-Bold.ttf"));
