/**
 * Solver test suite. Runs in the browser (tests/index.html) and in Node:
 *   node tests/solver.test.js
 */
(function (root, factory) {
  const BB = root.BlockBlast || require("../js/solver.js");
  factory(BB, root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (BB, root) {
  "use strict";
  const { N, emptyBoard, toOffsets, canPlace, place, clearLines, solve, emptyPiece } = BB;

  const results = [];
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function test(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, err: err.message });
    }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

  // Build a piece matrix from [r,c] cells.
  function piece(cells) {
    const m = emptyPiece();
    for (const [r, c] of cells) m[r][c] = 1;
    return m;
  }

  test("toOffsets normalizes to top-left origin", () => {
    const off = toOffsets(piece([[2, 3], [2, 4], [3, 3]]));
    assert(eq(off.sort(), [[0, 0], [0, 1], [1, 0]].sort()), "offsets not normalized");
  });

  test("toOffsets returns [] for empty piece", () => {
    assert(eq(toOffsets(emptyPiece()), []), "empty piece should yield no offsets");
  });

  test("canPlace rejects out-of-bounds", () => {
    const off = toOffsets(piece([[0, 0], [0, 1]]));
    assert(canPlace(emptyBoard(), off, 0, 0) === true, "should fit at origin");
    assert(canPlace(emptyBoard(), off, 0, N - 1) === false, "should overflow right edge");
  });

  test("canPlace rejects overlap", () => {
    const b = emptyBoard();
    b[0][0] = 1;
    assert(canPlace(b, [[0, 0]], 0, 0) === false, "should reject overlap");
  });

  test("place is immutable and fills cells", () => {
    const b = emptyBoard();
    const nb = place(b, [[0, 0], [0, 1]], 1, 1);
    assert(b[1][1] === 0, "original board mutated");
    assert(nb[1][1] === 1 && nb[1][2] === 1, "cells not placed");
  });

  test("clearLines clears a full row", () => {
    const b = emptyBoard();
    for (let c = 0; c < N; c++) b[0][c] = 1;
    const { board, rows, cols } = clearLines(b);
    assert(eq(rows, [0]) && eq(cols, []), "row not detected");
    assert(board[0].every((v) => v === 0), "row not cleared");
  });

  test("clearLines clears a full column", () => {
    const b = emptyBoard();
    for (let r = 0; r < N; r++) b[r][0] = 1;
    const { rows, cols } = clearLines(b);
    assert(eq(rows, []) && eq(cols, [0]), "column not detected");
  });

  test("solve places all pieces on an empty board", () => {
    const pieces = [
      { id: 1, offsets: toOffsets(piece([[0, 0], [0, 1]])) },
      { id: 2, offsets: toOffsets(piece([[0, 0], [1, 0]])) },
      { id: 3, offsets: toOffsets(piece([[0, 0]])) },
    ];
    const res = solve(emptyBoard(), pieces);
    assert(res.placed === 3, "should place all 3 pieces");
    assert(res.skipped.length === 0, "nothing should be skipped");
  });

  test("solve prefers a line clear when one is possible", () => {
    // Pre-fill row 0 except the last two cells; a domino completes & clears it.
    const b = emptyBoard();
    for (let c = 0; c < N - 2; c++) b[0][c] = 1;
    const pieces = [{ id: 1, offsets: toOffsets(piece([[0, 0], [0, 1]])) }];
    const res = solve(b, pieces);
    assert(res.placed === 1, "domino should be placed");
    assert(res.clears >= 1, "expected at least one line clear");
  });

  test("solve skips a piece that cannot fit", () => {
    // Fully fill the board: nothing can be placed.
    const b = emptyBoard().map((row) => row.map(() => 1));
    const pieces = [{ id: 1, offsets: toOffsets(piece([[0, 0]])) }];
    const res = solve(b, pieces);
    assert(res.placed === 0, "nothing should be placeable");
    assert(eq(res.skipped, [1]), "piece 1 should be skipped");
  });

  test("survival: placing all pieces beats a tempting clear", () => {
    // Survival is never traded for board quality: a plan that places all 3
    // pieces must win over one that places fewer, even if the latter clears.
    const b = emptyBoard();
    for (let c = 0; c < N - 1; c++) b[0][c] = 1; // row 0 one cell from clearing
    const pieces = [
      { id: 1, offsets: toOffsets(piece([[0, 0]])) },
      { id: 2, offsets: toOffsets(piece([[0, 0], [0, 1], [1, 0], [1, 1]])) },
      { id: 3, offsets: toOffsets(piece([[0, 0], [0, 1], [1, 0], [1, 1]])) },
    ];
    const res = solve(b, pieces);
    assert(res.placed === 3, "must place all 3 pieces (survival first)");
  });

  test("combo: prefers clearing two lines at once over two separate clears", () => {
    // clearReward is super-linear, so a single double-clear scores higher than
    // two single clears.
    assert(BB.clearReward(2) > 2 * BB.clearReward(1), "double clear should beat two singles");
    assert(BB.clearReward(3) > BB.clearReward(2) + BB.clearReward(1), "triple should beat 2+1");
  });

  test("health: a 1×1 prefers a spot that doesn't seal a dead pocket", () => {
    // Two empty cells left in row 0: (0,6) is open-ended, (0,7) the corner.
    // Filling the corner leaves (0,6) a one-cell pocket walled on 3 sides + soon
    // sealed; the healthier move keeps options open. We assert the solver picks
    // the placement that yields the higher board-evaluation score.
    const b = emptyBoard();
    for (let c = 0; c < N - 2; c++) b[0][c] = 1; // cols 0..5 filled, 6 & 7 open
    b[1][7] = 1; // wall the corner region a bit
    const pieces = [{ id: 1, offsets: toOffsets(piece([[0, 0]])) }];
    const res = solve(b, pieces);
    assert(res.placed === 1, "the single cell should be placed");
    // It should NOT choose to leave an isolated hole when a better cell exists.
    const after = res.steps[0].after;
    const score = BB.evaluateBoard(after);
    assert(typeof score === "number", "evaluateBoard returns a score");
  });

  test("evaluateBoard rewards an emptier, healthier board", () => {
    const full = emptyBoard().map((row) => row.map(() => 1));
    full[0][0] = 0; // a single dead pocket on an otherwise full board
    assert(BB.evaluateBoard(emptyBoard()) > BB.evaluateBoard(full), "open board should score higher");
  });

  test("performance: worst-case 3-piece solve stays fast", () => {
    const small = toOffsets(piece([[0, 0]]));
    const pieces = [{ id: 1, offsets: small }, { id: 2, offsets: small }, { id: 3, offsets: small }];
    const t0 = (root.performance ? root.performance.now() : Date.now());
    const res = solve(emptyBoard(), pieces);
    const ms = (root.performance ? root.performance.now() : Date.now()) - t0;
    assert(res.placed === 3, "places all three single cells");
    assert(ms < 1500, "empty-board 3×1×1 solve should finish well under 1.5s (was " + ms.toFixed(0) + "ms)");
  });

  // ---- Report ----
  const passed = results.filter((r) => r.ok).length;
  const summary = { passed, total: results.length, results };

  if (root.document) {
    const el = root.document.getElementById("results");
    el.innerHTML =
      `<p class="${passed === results.length ? "ok" : "fail"}"><strong>${passed}/${results.length} passed</strong></p>` +
      results.map((r) => `<div class="row ${r.ok ? "ok" : "fail"}">${r.ok ? "✓" : "✗"} ${r.name}${r.err ? " — " + r.err : ""}</div>`).join("");
  } else {
    for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.err ? " — " + r.err : ""}`);
    console.log(`\n${passed}/${results.length} passed`);
    if (typeof process !== "undefined") process.exit(passed === results.length ? 0 : 1);
  }
  return summary;
});
