/**
 * Block Blast Solver — pure solving engine.
 *
 * This module has ZERO DOM dependencies: it takes plain arrays in and returns
 * plain objects out. That makes it unit-testable (see /tests) and reusable
 * (could run in a Web Worker, Node, etc.).
 *
 * Exposed on `window.BlockBlast` for classic <script> use (works over file://),
 * and on `module.exports` when run under Node for tests.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node / tests
  root.BlockBlast = api;                                                     // Browser global
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const N = 8;    // The play board is 8 × 8.
  const PAD = 5;  // Each piece is drawn inside a 5 × 5 editing pad.

  /** A fresh empty N×N board (0 = empty, 1 = filled). */
  function emptyBoard() {
    return Array.from({ length: N }, () => Array(N).fill(0));
  }

  /** A fresh empty PAD×PAD piece matrix. */
  function emptyPiece() {
    return Array.from({ length: PAD }, () => Array(PAD).fill(0));
  }

  /**
   * Normalize a filled-cell matrix into a list of [row, col] offsets whose
   * bounding box starts at (0,0). Padding around the drawn shape is trimmed so
   * the same shape drawn anywhere in the pad behaves identically.
   */
  function toOffsets(matrix) {
    const cells = [];
    for (let r = 0; r < matrix.length; r++)
      for (let c = 0; c < matrix[r].length; c++)
        if (matrix[r][c]) cells.push([r, c]);
    if (!cells.length) return [];
    let minR = Infinity, minC = Infinity;
    for (const [r, c] of cells) { if (r < minR) minR = r; if (c < minC) minC = c; }
    return cells.map(([r, c]) => [r - minR, c - minC]);
  }

  /** Can shape `offsets` be dropped with its top-left corner at board (top,left)? */
  function canPlace(board, offsets, top, left) {
    for (const [dr, dc] of offsets) {
      const r = top + dr, c = left + dc;
      if (r < 0 || r >= N || c < 0 || c >= N) return false; // off the edge
      if (board[r][c]) return false;                        // overlaps a filled cell
    }
    return true;
  }

  /** Return a NEW board with `offsets` placed at (top,left). Does not mutate. */
  function place(board, offsets, top, left) {
    const next = board.map((row) => row.slice());
    for (const [dr, dc] of offsets) next[top + dr][left + dc] = 1;
    return next;
  }

  /**
   * Apply Block Blast line clearing: any fully-filled row or column empties.
   * Returns the new board plus which rows/cols cleared (for visualization).
   */
  function clearLines(board) {
    const rows = [], cols = [];
    for (let r = 0; r < N; r++) if (board[r].every((v) => v)) rows.push(r);
    for (let c = 0; c < N; c++) {
      let full = true;
      for (let r = 0; r < N; r++) if (!board[r][c]) { full = false; break; }
      if (full) cols.push(c);
    }
    const next = board.map((row) => row.slice());
    for (const r of rows) for (let c = 0; c < N; c++) next[r][c] = 0;
    for (const c of cols) for (let r = 0; r < N; r++) next[r][c] = 0;
    return { board: next, rows, cols };
  }

  // ----------------------------------------------------- board heuristics ----
  //
  // Placing the most pieces this turn is necessary but NOT sufficient: the
  // guides for Block Blast are unanimous that the players who survive longest
  // and score highest do it by keeping the board *healthy* for the pieces they
  // haven't seen yet. The classic advice distilled from those guides:
  //
  //   • Keep the board as open as possible        → reward empty cells.
  //   • Don't get stuck — leave room for big       → reward how many canonical
  //     awkward shapes (lines, 2×2, 3×3).            "stress-test" pieces still fit.
  //   • Pack pieces flush against walls/each       → penalize the empty↔filled
  //     other; avoid jagged gaps.                     boundary (bumpiness).
  //   • Never create one-cell dead pockets.        → penalize isolated holes.
  //   • Keep the center flexible.                  → small bonus for open center.
  //   • Chase multi-line clears / combos.          → escalating per-step reward
  //                                                   (handled in `solve`).
  //
  // These weights are deliberately grouped here so the strategy is easy to read
  // and tune. They are balanced so that "place all pieces" (handled by the
  // lexicographic `placed` priority in `solve`) is never traded away — the
  // heuristic only ever breaks ties between equally-many placements.
  const W = {
    emptyCell: 1.0, // each open cell = breathing room for future pieces
    fit: 14.0, // each stress-test shape that can still be placed somewhere
    hole: -7.0, // each empty cell walled in on all four sides (1×1-only)
    bumpiness: -0.6, // each empty cell face touching a filled cell
    centerOpen: 0.7, // each open cell in the central 4×4
  };

  // Canonical "stress-test" shapes — the placements that most often end a run.
  // If these still fit, the board can absorb almost anything the game deals.
  const STRESS_PIECES = [
    [[0, 0], [0, 1], [1, 0], [1, 1]],                           // 2×2 square
    [[0, 0], [0, 1], [0, 2]],                                   // 1×3 line
    [[0, 0], [1, 0], [2, 0]],                                   // 3×1 line
    [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],                   // 1×5 line
    [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],                   // 5×1 line
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], // 3×3 square
  ];

  /** Does `offsets` fit anywhere on `board`? (early-exit scan) */
  function fitsAnywhere(board, offsets) {
    for (let t = 0; t < N; t++)
      for (let l = 0; l < N; l++)
        if (canPlace(board, offsets, t, l)) return true;
    return false;
  }

  /**
   * Score a resulting board on long-term health (higher = better). This is what
   * separates a placement that merely works *this* turn from one that keeps the
   * run alive. Pure function of the board; see `W` above for the rationale.
   */
  function evaluateBoard(board) {
    let empty = 0, holes = 0, bumpiness = 0, centerOpen = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (board[r][c]) continue;
        empty++;
        if (r >= 2 && r <= 5 && c >= 2 && c <= 5) centerOpen++;
        // Count filled (or wall) neighbours: bumpiness + dead-pocket detection.
        let walled = 0;
        if (r === 0 || board[r - 1][c]) walled++;
        if (r === N - 1 || board[r + 1][c]) walled++;
        if (c === 0 || board[r][c - 1]) walled++;
        if (c === N - 1 || board[r][c + 1]) walled++;
        // bumpiness only counts *filled-cell* contact, not the outer wall, so
        // hugging the edge is encouraged while jagged interior gaps are not.
        if (r > 0 && board[r - 1][c]) bumpiness++;
        if (r < N - 1 && board[r + 1][c]) bumpiness++;
        if (c > 0 && board[r][c - 1]) bumpiness++;
        if (c < N - 1 && board[r][c + 1]) bumpiness++;
        if (walled === 4) holes++; // only a 1×1 can ever fill this cell
      }
    }
    let fit = 0;
    for (const shape of STRESS_PIECES) if (fitsAnywhere(board, shape)) fit++;

    return (
      W.emptyCell * empty +
      W.fit * fit +
      W.hole * holes +
      W.bumpiness * bumpiness +
      W.centerOpen * centerOpen
    );
  }

  /**
   * Reward for clearing `n` lines in a *single* placement. Block Blast pays a
   * bonus for simultaneous multi-line clears (and the guides push hard for
   * combos), so the reward grows super-linearly: 1→12, 2→34, 3→66, 4→108…
   */
  function clearReward(n) {
    return n <= 0 ? 0 : 12 * n + 11 * n * (n - 1);
  }

  /**
   * Find the best plan for placing `pieces` on `board`.
   *
   * pieces: [{ id, offsets }]  (offsets from toOffsets)
   *
   * Objective, in strict priority order:
   *   1. place as many pieces as possible (survival — never sacrificed), then
   *   2. maximize a "quality" score = Σ per-step combo reward (multi-line
   *      clears) + the long-term health of the final board (see evaluateBoard).
   *
   * Because the quality score is additive along a path and exactly one board-
   * evaluation term lands at each leaf, the recursive max is a true global max
   * over all placement orders and positions.
   *
   * Returns { steps, placed, clears, score, skipped, explored } where each step
   * is { id, top, left, before, placedCells, rows, cols, after }.
   *
   * Complexity is O((N²)^k) worst case for k pieces, but k ≤ 3 here so it is
   * effectively instant. The `explored` counter reports the real work done.
   */
  function solve(board, pieces) {
    let explored = 0;

    // Identical-shaped pieces are interchangeable, so trying every ordering of
    // them just re-discovers the same boards k! times. Tag each piece with a
    // shape key and, at each node, only branch on the first piece of each shape.
    const shapeKey = (p) => JSON.stringify(p.offsets);

    function search(g, remaining) {
      // Baseline: place nothing further. The final board is `g`, so its quality
      // is this leaf's score; whatever is left over is skipped.
      let best = {
        steps: [],
        clears: 0,
        placed: 0,
        score: evaluateBoard(g),
        skipped: remaining.map((p) => p.id),
      };

      const triedShapes = new Set();
      for (const piece of remaining) {
        const key = shapeKey(piece);
        if (triedShapes.has(key)) continue; // an identical shape was already tried
        triedShapes.add(key);
        const { offsets, id } = piece;
        const rest = remaining.filter((p) => p !== piece);
        for (let t = 0; t < N; t++) {
          for (let l = 0; l < N; l++) {
            if (!canPlace(g, offsets, t, l)) continue;
            explored++;
            const placedCells = offsets.map(([dr, dc]) => [t + dr, l + dc]);
            const { board: after, rows, cols } = clearLines(place(g, offsets, t, l));
            const lines = rows.length + cols.length;
            const sub = search(after, rest);
            const candidate = {
              steps: [{ id, top: t, left: l, before: g, placedCells, rows, cols, after }, ...sub.steps],
              clears: lines + sub.clears,
              placed: 1 + sub.placed,
              score: clearReward(lines) + sub.score, // combo reward + downstream
              skipped: sub.skipped,
            };
            if (
              candidate.placed > best.placed ||
              (candidate.placed === best.placed && candidate.score > best.score)
            ) {
              best = candidate;
            }
          }
        }
      }
      return best;
    }

    const result = search(board, pieces);
    result.explored = explored;
    return result;
  }

  return {
    N, PAD, emptyBoard, emptyPiece, toOffsets, canPlace, place, clearLines,
    evaluateBoard, clearReward, solve,
  };
});
