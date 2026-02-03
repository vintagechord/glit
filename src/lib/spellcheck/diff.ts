import type { SpellcheckDiff } from "./types";

type Edit = { type: "equal" | "insert" | "delete"; aIndex?: number; bIndex?: number };

const buildEdits = (aChars: string[], bChars: string[], trace: number[][]) => {
  const edits: Edit[] = [];
  const max = aChars.length + bChars.length;
  let x = aChars.length;
  let y = bChars.length;

  for (let d = trace.length - 1; d > 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const idx = max + k;
    const prevK =
      k === -d || (k !== d && v[idx - 1] < v[idx + 1]) ? k + 1 : k - 1;
    const prevIdx = max + prevK;
    const prevX = v[prevIdx];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      edits.push({ type: "equal", aIndex: x - 1, bIndex: y - 1 });
      x -= 1;
      y -= 1;
    }

    if (x === prevX) {
      edits.push({ type: "insert", bIndex: y - 1 });
      y -= 1;
    } else {
      edits.push({ type: "delete", aIndex: x - 1 });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    edits.push({ type: "equal", aIndex: x - 1, bIndex: y - 1 });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    edits.push({ type: "delete", aIndex: x - 1 });
    x -= 1;
  }
  while (y > 0) {
    edits.push({ type: "insert", bIndex: y - 1 });
    y -= 1;
  }

  edits.reverse();
  return edits;
};

export const diffText = (a: string, b: string): SpellcheckDiff[] => {
  if (a === b) {
    return a
      ? [
          {
            op: "equal",
            a,
            b: a,
            indexA: 0,
            indexB: 0,
          },
        ]
      : [];
  }

  const aChars = a.split("");
  const bChars = b.split("");
  const n = aChars.length;
  const m = bChars.length;
  const max = n + m;
  const v = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d += 1) {
    const vSnapshot = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const idx = max + k;
      let x;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
        x = v[idx + 1];
      } else {
        x = v[idx - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && aChars[x] === bChars[y]) {
        x += 1;
        y += 1;
      }
      vSnapshot[idx] = x;
      if (x >= n && y >= m) {
        trace.push(vSnapshot);
        const edits = buildEdits(aChars, bChars, trace);
        return buildDiffOps(aChars, bChars, edits);
      }
    }
    trace.push(vSnapshot);
    for (let i = 0; i < v.length; i += 1) v[i] = vSnapshot[i];
  }

  const edits = buildEdits(aChars, bChars, trace);
  return buildDiffOps(aChars, bChars, edits);
};

const buildDiffOps = (aChars: string[], bChars: string[], edits: Edit[]) => {
  const diffs: SpellcheckDiff[] = [];
  let indexA = 0;
  let indexB = 0;
  let current: SpellcheckDiff | null = null;

  const flush = () => {
    if (!current) return;
    diffs.push(current);
    current = null;
  };

  edits.forEach((edit) => {
    if (edit.type === "equal") {
      const char = aChars[indexA] ?? "";
      if (!current || current.op !== "equal") {
        flush();
        current = {
          op: "equal",
          a: char,
          b: char,
          indexA,
          indexB,
        };
      } else {
        current.a += char;
        current.b += char;
      }
      indexA += 1;
      indexB += 1;
      return;
    }
    if (edit.type === "delete") {
      const char = aChars[indexA] ?? "";
      if (!current || current.op !== "delete") {
        flush();
        current = {
          op: "delete",
          a: char,
          b: "",
          indexA,
          indexB,
        };
      } else {
        current.a += char;
      }
      indexA += 1;
      return;
    }
    const char = bChars[indexB] ?? "";
    if (!current || current.op !== "insert") {
      flush();
      current = {
        op: "insert",
        a: "",
        b: char,
        indexA,
        indexB,
      };
    } else {
      current.b += char;
    }
    indexB += 1;
  });

  flush();

  const merged: SpellcheckDiff[] = [];
  for (let i = 0; i < diffs.length; i += 1) {
    const currentDiff = diffs[i];
    const next = diffs[i + 1];
    if (
      currentDiff.op === "delete" &&
      next &&
      next.op === "insert" &&
      currentDiff.indexA === next.indexA &&
      currentDiff.indexB === next.indexB
    ) {
      merged.push({
        op: "replace",
        a: currentDiff.a,
        b: next.b,
        indexA: currentDiff.indexA,
        indexB: currentDiff.indexB,
      });
      i += 1;
      continue;
    }
    merged.push(currentDiff);
  }

  return merged;
};
