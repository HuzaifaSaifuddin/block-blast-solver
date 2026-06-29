/**
 * Block Blast Solver — application layer (UI + interaction).
 *
 * Depends on window.BlockBlast (js/solver.js). No inline handlers, no eval,
 * no framework. Input works with mouse, touch, pen, and keyboard.
 */
(function () {
  "use strict";

  const BB = window.BlockBlast;
  const { N, emptyBoard, emptyPiece, toOffsets, solve } = BB;

  const STORAGE_KEY = "block-blast-solver:v2";
  const THEME_KEY = "block-blast-solver:theme";

  // --------------------------------------------------------------- state ----
  let board = emptyBoard();
  let pieces = [emptyPiece(), emptyPiece(), emptyPiece()];
  let pendingFinal = null; // result board awaiting "use as new board"

  const $ = (sel) => document.querySelector(sel);

  // --------------------------------------------------------- persistence ----
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ board, pieces }));
    } catch (_) {}
  }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!data) return;
      if (Array.isArray(data.board) && data.board.length === N) board = data.board;
      if (Array.isArray(data.pieces) && data.pieces.length === 3) pieces = data.pieces;
    } catch (_) {}
  }

  // ------------------------------------------------------------- theming ----
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = $("#themeToggle");
    if (btn) {
      btn.setAttribute("aria-pressed", String(theme === "dark"));
      btn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
  }
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (prefersDark ? "dark" : "light"));
  }
  function toggleTheme() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  // -------------------------------------------------- generic paint grid ----
  // A single shared painting session so document-level listeners are attached
  // exactly once, no matter how many grids get (re)built.
  let activePaint = null; // { grid, value } while a pointer drag is in progress

  function paintCell(grid, r, c, value) {
    if (grid.data[r][c] === value) return;
    grid.data[r][c] = value;
    const el = grid.cellEls[r][c];
    el.classList.toggle("on", !!value);
    el.setAttribute("aria-pressed", value ? "true" : "false");
    grid.onChange();
  }

  function cellUnderPointer(grid, e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !el.classList.contains("cell") || !grid.host.contains(el)) return null;
    return { r: +el.dataset.r, c: +el.dataset.c };
  }

  document.addEventListener("pointermove", (e) => {
    if (!activePaint) return;
    const hit = cellUnderPointer(activePaint.grid, e);
    if (hit) paintCell(activePaint.grid, hit.r, hit.c, activePaint.value);
  });
  const endPaint = () => { activePaint = null; };
  document.addEventListener("pointerup", endPaint);
  document.addEventListener("pointercancel", endPaint);

  /**
   * Build an editable grid bound to `data` (a 2D 0/1 array).
   * Supports pointer (mouse/touch/pen) drag-painting and full keyboard control
   * with roving tabindex + arrow navigation. Calls onChange after edits.
   */
  function buildGrid(host, data, sizeClass, onChange) {
    host.innerHTML = "";
    host.className = `bb-grid ${sizeClass}`;
    host.setAttribute("role", "grid");
    host.setAttribute("aria-label", host.dataset.label || "grid");

    const rows = data.length, cols = data[0].length;
    const cellEls = []; // cellEls[r][c]

    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "bb-row";
      rowEl.setAttribute("role", "row");
      const rowCells = [];
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement("div");
        cell.className = "cell" + (data[r][c] ? " on" : "");
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `row ${r + 1}, column ${c + 1}`);
        cell.setAttribute("aria-pressed", data[r][c] ? "true" : "false");
        cell.tabIndex = r === 0 && c === 0 ? 0 : -1;
        cell.dataset.r = r;
        cell.dataset.c = c;
        rowCells.push(cell);
        rowEl.appendChild(cell);
      }
      cellEls.push(rowCells);
      host.appendChild(rowEl);
    }

    const grid = { host, data, cellEls, onChange };

    // ----- Pointer painting (mouse + touch + pen unified) -----
    host.addEventListener("pointerdown", (e) => {
      const hit = cellUnderPointer(grid, e);
      if (!hit) return;
      e.preventDefault();
      // Disable implicit pointer capture so move events resolve to other cells.
      try { e.target.releasePointerCapture && e.target.releasePointerCapture(e.pointerId); } catch (_) {}
      const value = data[hit.r][hit.c] ? 0 : 1; // first cell decides draw vs erase
      activePaint = { grid, value };
      paintCell(grid, hit.r, hit.c, value);
      cellEls[hit.r][hit.c].focus();
    });

    // ----- Keyboard control (roving tabindex) -----
    host.addEventListener("keydown", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        paintCell(grid, r, c, data[r][c] ? 0 : 1);
        return;
      }
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (!moves[e.key]) return;
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      const nr = Math.max(0, Math.min(rows - 1, r + dr));
      const nc = Math.max(0, Math.min(cols - 1, c + dc));
      cell.tabIndex = -1;
      const target = cellEls[nr][nc];
      target.tabIndex = 0;
      target.focus();
    });
  }

  // --------------------------------------------------------- render UI ------
  function renderBoard() {
    const host = $("#mainGrid");
    host.dataset.label = "Main 8 by 8 board";
    buildGrid(host, board, "main", save);
  }

  function renderPieces() {
    const host = $("#blocks");
    host.innerHTML = "";
    for (let b = 0; b < 3; b++) {
      const wrap = document.createElement("div");
      wrap.className = "blockwrap";

      const head = document.createElement("div");
      head.className = "blockhead";

      const title = document.createElement("span");
      title.className = "blocktitle";
      title.textContent = `Block ${b + 1}`;

      const clr = document.createElement("button");
      clr.className = "tiny";
      clr.textContent = "clear";
      clr.addEventListener("click", () => {
        pieces[b] = emptyPiece();
        renderPieces();
        save();
      });

      head.appendChild(title);
      head.appendChild(clr);

      const grid = document.createElement("div");
      grid.dataset.label = `Block ${b + 1} shape, 5 by 5`;
      buildGrid(grid, pieces[b], "block", save);

      wrap.appendChild(head);
      wrap.appendChild(grid);
      host.appendChild(wrap);
    }
  }

  // ---------------------------------------------------------- solving -------
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }

  function miniGrid(g, placedSet, clearSet) {
    let h = '<div class="mini">';
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const key = r + "," + c;
        let cls = "mc";
        if (placedSet && placedSet.has(key)) cls += " placed";
        else if (g[r][c]) cls += " on";
        if (clearSet && clearSet.has(key)) cls += " clear";
        h += `<div class="${cls}"></div>`;
      }
    return h + "</div>";
  }

  function solveNow() {
    const out = $("#out");
    const list = [];
    for (let b = 0; b < 3; b++) {
      const offsets = toOffsets(pieces[b]);
      if (offsets.length) list.push({ id: b + 1, offsets });
    }
    if (!list.length) {
      out.innerHTML = '<p class="note bad">No pieces to place — draw at least one piece.</p>';
      $("#applyBar").hidden = true;
      return;
    }

    const t0 = performance.now();
    const res = solve(board, list);
    const ms = performance.now() - t0;
    const steps = res.steps;

    if (res.placed === 0) {
      out.innerHTML = '<p class="note bad">No piece can be placed on this board at all.</p>';
      $("#applyBar").hidden = true;
      return;
    }

    let summary;
    if (res.skipped.length) {
      summary = `<p class="note bad">Best possible: placed ${res.placed} of ${list.length},
        must skip Block ${res.skipped.join(", ")} (won't fit even after clears).
        Cleared ${res.clears} line${res.clears !== 1 ? "s" : ""}.</p>`;
    } else {
      summary = `<p class="note good">Placed all ${res.placed} pieces &mdash;
        cleared ${res.clears} line${res.clears !== 1 ? "s" : ""} (the most possible).</p>`;
    }
    const timing = `<p class="hint">Solved in ${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms
      — explored ${res.explored.toLocaleString()} placement${res.explored !== 1 ? "s" : ""}.</p>`;

    let html = `<div class="solhead"><div>${summary}${timing}</div></div><div class="steps">`;
    steps.forEach((s, i) => {
      const placedSet = new Set(s.placedCells.map(([r, c]) => r + "," + c));
      const clearSet = new Set();
      s.rows.forEach((r) => { for (let c = 0; c < N; c++) clearSet.add(r + "," + c); });
      s.cols.forEach((c) => { for (let r = 0; r < N; r++) clearSet.add(r + "," + c); });
      const beforeMarked = s.before.map((row) => row.slice());
      for (const [r, c] of s.placedCells) beforeMarked[r][c] = 1;

      const tl = s.placedCells.reduce((a, [r, c]) => (r < a[0] || (r === a[0] && c < a[1]) ? [r, c] : a), [9, 9]);
      let note = "";
      if (s.rows.length || s.cols.length) {
        const parts = [];
        if (s.rows.length) parts.push("row" + (s.rows.length > 1 ? "s" : "") + " " + s.rows.map((r) => r + 1).join(", "));
        if (s.cols.length) parts.push("column" + (s.cols.length > 1 ? "s" : "") + " " + s.cols.map((c) => c + 1).join(", "));
        note = `<p class="note good">→ clears ${parts.join(" and ")}!</p>`;
      }
      html += `<div class="step">
        <p class="steptitle"><span class="pill">${i + 1}</span>Place Block ${s.id} at row ${tl[0] + 1}, col ${tl[1] + 1}</p>
        <div class="miniwrap">
          <div class="minicol"><span class="minicap">place it</span>${miniGrid(beforeMarked, placedSet, clearSet)}</div>
          <div class="minicol"><span class="minicap">after this step</span>${miniGrid(s.after)}</div>
        </div>${note}
      </div>`;
    });
    html += "</div>";
    out.innerHTML = html;

    pendingFinal = steps[steps.length - 1].after;
    $("#applyBar").hidden = false;
  }

  function applyFinal() {
    if (!pendingFinal) return;
    board = pendingFinal.map((row) => row.slice());
    pieces = [emptyPiece(), emptyPiece(), emptyPiece()];
    renderBoard();
    renderPieces();
    save();
    $("#out").innerHTML = '<p class="muted">Board updated. Draw the next pieces and Solve again.</p>';
    $("#applyBar").hidden = true;
    pendingFinal = null;
    toast("Board updated with the solved result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // --------------------------------------------------------- utilities ------
  function clearBoard() { board = emptyBoard(); renderBoard(); save(); }
  function resetAll() {
    board = emptyBoard();
    pieces = [emptyPiece(), emptyPiece(), emptyPiece()];
    pendingFinal = null;
    renderBoard();
    renderPieces();
    $("#out").innerHTML = '<p class="muted">Draw a board and pieces, then hit Solve.</p>';
    $("#applyBar").hidden = true;
    save();
    toast("Everything reset");
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // --------------------------------------------------------------- init -----
  function init() {
    load();
    initTheme();
    renderBoard();
    renderPieces();

    $("#solveBtn").addEventListener("click", solveNow);
    $("#resetBtn").addEventListener("click", resetAll);
    $("#clearMainBtn").addEventListener("click", clearBoard);
    $("#applyBtn").addEventListener("click", applyFinal);
    $("#themeToggle").addEventListener("click", toggleTheme);

    // Keyboard shortcut: Ctrl/Cmd+Enter solves.
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); solveNow(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
