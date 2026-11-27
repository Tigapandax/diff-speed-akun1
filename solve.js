// diff-speed: a fast, dependency-free drop-in for makefun-diff 1.0.0.
//
// What it does, in its own words: given { old, new }, two texts, it returns
// makefun-diff's patch of the old text into the new one, as one JSON string
// (the caller wraps it in JSON; run() itself returns the patch string, the
// same value the reference returns for the same input).
//
// How it works:
//  1. Split each text into lines after every "\n" (a "\r" stays part of its
//     line; a last line with no "\n" is a line too; the empty text has none).
//  2. Intern every distinct line to a small integer id, so all later line
//     comparisons are integer comparisons on typed arrays.
//  3. Strip the longest common prefix of lines, then the longest common
//     suffix of what is left.
//  4. On the middle slice, run Myers's greedy shortest-edit search exactly
//     as the reference specifies it: for d = 0, 1, 2, ... and each diagonal
//     k = x - y from -d to d in steps of 2, the furthest point a path of d
//     edits reaches on k is one old line past the furthest (d-1)-point on
//     diagonal k - 1 (a deletion) or one new line past the furthest
//     (d-1)-point on diagonal k + 1 (an insertion), whichever reaches
//     further into the old text, the deletion winning a tie; a move past
//     either text's end is no candidate; no edge diagonal is pruned; from
//     that point the path follows every run of lines equal in both as far
//     as it goes. The first path to reach both ends is the script. The
//     furthest x reached on every diagonal of every d is kept in a typed
//     array, and the script is rebuilt by walking those arrays backwards
//     from (N, M), re-applying the same tie-break at every step.
//  5. Render the patch: one header line, then hunks of at most 3 kept
//     lines of context around each change run, runs at most 6 kept lines
//     apart sharing a hunk, deletions listed before insertions inside a
//     run, and a "%" line after any line that ends its text with no
//     newline. Identical texts give the header line alone.
//
// Nothing is cached from one case to the next: every call re-interns its
// own lines and runs its own search.

const KEEP = 0;
const DEL = 1;
const INS = 2;

/** A text's lines, each keeping its "\n" except possibly the last one. */
function splitLines(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      if (start < text.length) lines.push(text.slice(start));
      return lines;
    }
    lines.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
}

/** Replace each line by its integer id in one shared table (equal lines share an id). */
function intern(lines, table) {
  const ids = new Int32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let id = table.get(s);
    if (id === undefined) {
      id = table.size;
      table.set(s, id);
    }
    ids[i] = id;
  }
  return ids;
}

/**
 * The edit script turning A[a0..a1) into B[b0..b1), as runs [kind, count]
 * in order (KEEP / DEL / INS). Myers's greedy search, forward pass storing
 * each depth's furthest-x per diagonal, then a backwards rebuild.
 *
 * Speed shape: one flat Int32Array holds every depth's row, so there is no
 * per-depth allocation and no fill. Row d starts at off(d) = d*d + 4*d and
 * carries two guard slots on each side (left at off(d) and off(d) + 1,
 * right at off(d) + 2d + 3 and off(d) + 2d + 4) that are never written and
 * stay zero, decoding as "no path"; its 2d + 1 live slots sit at
 * off(d) + 2 + j for j = k + d = 0..2d. A live slot holds x + 1 (0 means no
 * path), so a fresh buffer needs no initialising fill. With the guards,
 * the predecessor lookups for the edge diagonals land on a guard instead
 * of needing a bounds check, so the inner loop has none.
 */
function myersRuns(A, B, a0, a1, b0, b1) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 && m === 0) return [];

  const off = (d) => d * d + 4 * d;
  let buf = new Int32Array(off(1025)); // room for depths 0..1024
  const grow = (d) => {
    while (off(d + 1) > buf.length) {
      const nb = new Int32Array(buf.length * 2 + 1024);
      nb.set(buf);
      buf = nb;
    }
  };

  // Forward pass. d = 0 first: the run of equal lines from (0, 0).
  let x = 0;
  let y = 0;
  while (x < n && y < m && A[a0 + x] === B[b0 + y]) {
    x++;
    y++;
  }
  buf[off(0) + 2] = x + 1;
  let D = -1;
  if (x === n && y === m) {
    D = 0;
  } else {
    outer: for (let d = 1; d <= n + m; d++) {
      grow(d);
      const base = off(d) + 2;
      const pb = off(d - 1) + 2;
      for (let j = 0; j <= 2 * d; j += 2) {
        // Predecessor on k - 1 (deletion) lives at index j - 2 of the
        // previous row; predecessor on k + 1 (insertion) at index j.
        // Either may be a guard slot, which reads as "no path".
        const xDelPrev = buf[pb + j - 2] - 1;
        const xInsPrev = buf[pb + j] - 1;
        // A deletion consumes old line xDelPrev (needs one left); an
        // insertion consumes new line xInsPrev - (k + 1) (needs one left).
        const canDel = xDelPrev >= 0 && xDelPrev < n;
        const canIns = xInsPrev >= 0 && xInsPrev - (j - d + 1) < m;
        const xDel = canDel ? xDelPrev + 1 : -1;
        const xIns = canIns ? xInsPrev : -1;
        if (xDel < 0 && xIns < 0) continue;
        // Further into the old text wins; the deletion wins a tie.
        let xx = xDel >= xIns ? xDel : xIns;
        let yy = xx - (j - d);
        let ai = a0 + xx;
        let bi = b0 + yy;
        while (xx < n && yy < m && A[ai] === B[bi]) {
          xx++;
          yy++;
          ai++;
          bi++;
        }
        buf[base + j] = xx + 1;
        if (xx === n && yy === m) {
          D = d;
          break outer;
        }
      }
    }
  }
  if (D < 0) throw new Error('diff-speed: the search ended without reaching both ends');

  // Backwards rebuild, from (n, m) at depth D down to the d = 0 point.
  const rev = [];
  let cx = n;
  let cy = m;
  for (let d = D; d >= 1; d--) {
    const k = cx - cy;
    const pb = off(d - 1) + 2;
    const j = k + d;
    const xDelPrev = buf[pb + j - 2] - 1;
    const xInsPrev = buf[pb + j] - 1;
    const canDel = xDelPrev >= 0 && xDelPrev < n;
    const canIns = xInsPrev >= 0 && xInsPrev - (k + 1) < m;
    const xDel = canDel ? xDelPrev + 1 : -1;
    const xIns = canIns ? xInsPrev : -1;
    let xPre;
    let kind;
    let px;
    let py;
    if (xDel >= xIns) {
      xPre = xDel;
      kind = DEL;
      px = xDelPrev;
      py = xDelPrev - (k - 1);
    } else {
      xPre = xIns;
      kind = INS;
      px = xInsPrev;
      py = xInsPrev - (k + 1);
    }
    // The run of equal lines the forward pass followed from the
    // pre-edit point (xPre, xPre - k) to (cx, cy) is all kept lines.
    const keeps = cx - xPre;
    if (keeps > 0) rev.push([KEEP, keeps]);
    rev.push([kind, 1]);
    cx = px;
    cy = py;
  }
  if (cx > 0) rev.push([KEEP, cx]);
  rev.reverse();
  return rev;
}

/** One patch line: its op, the line, and "%" on a line of its own when the line had no newline. */
function emit(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** The patch of the two texts' lines under the given edit-script runs. */
function renderPatch(a, b, runs) {
  const n = a.length;
  const m = b.length;
  // The change runs: each a stretch of deletions and insertions between
  // two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const [kind, count] of runs) {
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }
  // The hunks: change runs at most 6 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(emit('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(emit('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(emit('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(emit('=', a[at]));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input: its patch of { old, new }. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff-speed: the input is { old, new }, two strings');
  }
  const a = splitLines(input.old);
  const b = splitLines(input.new);
  const n = a.length;
  const m = b.length;
  const table = new Map();
  const A = intern(a, table);
  const B = intern(b, table);
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  for (const r of myersRuns(A, B, prefix, n - suffix, prefix, m - suffix)) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === r[0]) last[1] += r[1];
    else runs.push([r[0], r[1]]);
  }
  if (suffix > 0) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === KEEP) last[1] += suffix;
    else runs.push([KEEP, suffix]);
  }
  return renderPatch(a, b, runs);
}
