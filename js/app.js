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
  const TRACE_KEY = "block-blast-solver:trace";

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

  // ---------------------------------------------- search visualizer ---------
  // Animated replay of every placement the solver tried, in visitation order.
  // A trace can be tens of thousands of frames, so playback is a real media
  // player: play/pause, single-step, a scrubber to jump anywhere, and a delay
  // slider. The 64 board cells are built once; each frame only toggles classes.
  let player = null; // { frames, idx, playing, timer, delay, cellEls, ...els }

  const sameCells = (a, b) => {
    if (a.length !== b.length) return false;
    const s = new Set(a.map(([r, c]) => r + "," + c));
    return b.every(([r, c]) => s.has(r + "," + c));
  };

  // Tag the frames that belong to the winning plan, so the animation can call
  // them out as they fly by. A chosen step and its frame share the exact same
  // `before`/`board` array reference (same search node), so identity is safe.
  function markAccepted(trace, steps) {
    for (const f of trace)
      f.accepted = steps.some((s) => s.before === f.board && sameCells(s.placedCells, f.placedCells));
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 1) return "under a second";
    if (s < 60) return "~" + s + "s";
    return "~" + Math.floor(s / 60) + "m " + (s % 60) + "s";
  }

  function tracePaint() {
    const { frames, idx, cellEls } = player;
    const f = frames[idx];
    const placed = new Set(f.placedCells.map(([r, c]) => r + "," + c));
    const clearing = new Set();
    f.rows.forEach((r) => { for (let c = 0; c < N; c++) clearing.add(r + "," + c); });
    f.cols.forEach((c) => { for (let r = 0; r < N; r++) clearing.add(r + "," + c); });
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const key = r + "," + c;
        let cls = "tc";
        const slot = f.origin && f.origin[r][c];
        if (placed.has(key)) cls += " try d" + (f.depth + 1);
        else if (f.board[r][c]) {
          cls += " on";
          // Colour already-settled cells by which slot (block 1/2/3) placed
          // them, so earlier picks stay visible instead of blending into one
          // generic "filled" colour once later pieces are being tried on top.
          if (slot != null && slot >= 0) cls += " d" + (slot + 1);
        } else if (slot === -1) {
          // GHOST: this cell was cleared somewhere earlier in this branch and
          // hasn't been refilled since — keep showing it blurred rather than
          // letting it blink straight back to plain empty background.
          cls += " ghost";
        }
        if (clearing.has(key)) cls += " clearing";
        cellEls[r][c].className = cls;
      }
    const lines = f.rows.length + f.cols.length;
    const bits = [
      `Placement <b>${(idx + 1).toLocaleString()}</b> of ${frames.length.toLocaleString()}`,
      `trying Block ${f.id} into slot ${f.depth + 1}`,
    ];
    if (lines) bits.push(`<span class="tgood">would clear ${lines} line${lines !== 1 ? "s" : ""}</span>`);
    if (f.accepted) bits.push(`<span class="tkept">✓ kept in the final plan</span>`);
    player.label.innerHTML = bits.join(" · ");
    player.scrub.value = idx; // programmatic set does not fire an 'input' event
  }

  function traceTick() {
    if (!player || !player.playing) return;
    if (player.idx >= player.frames.length - 1) { tracePause(); return; }
    player.idx++;
    tracePaint();
    player.timer = setTimeout(traceTick, Math.max(0, player.delay));
  }
  function tracePlay() {
    if (!player) return;
    if (player.idx >= player.frames.length - 1) player.idx = 0; // replay from the top
    player.playing = true;
    player.playBtn.textContent = "❚❚ Pause";
    player.timer = setTimeout(traceTick, Math.max(0, player.delay));
  }
  function tracePause() {
    if (!player) return;
    player.playing = false;
    if (player.timer) clearTimeout(player.timer);
    player.playBtn.textContent = "▶ Play";
  }
  function stopTracePlayer() {
    if (player && player.timer) clearTimeout(player.timer);
    player = null;
    const v = $("#traceView");
    if (v) v.innerHTML = "";
  }
  function hideTrace() {
    stopTracePlayer();
    const p = $("#tracePanel");
    if (p) p.hidden = true;
  }

  // Browsers clamp setTimeout(fn, 0) to a real floor, and repainting 64 cells
  // plus the label costs more on top of that — so "0ms delay" never actually
  // plays back at 0ms/frame (measured ~5ms/frame in practice, e.g. 1,292
  // frames took ~6s end to end). Floor the ETA math to match what actually
  // happens on screen instead of promising an impossible instant run.
  const MIN_FRAME_MS = 5;

  function updateSpeedLabel() {
    player.speedVal.textContent = player.delay + "ms";
    const perFrame = Math.max(player.delay, MIN_FRAME_MS);
    player.eta.textContent =
      `At ${player.delay}ms each, watching all ${player.frames.length.toLocaleString()} ` +
      `takes ${fmtDuration(player.frames.length * perFrame)} — drag the top slider to jump anywhere.`;
  }

  function buildTracePlayer(frames, truncated, explored) {
    stopTracePlayer();
    const view = $("#traceView");
    const trunc = truncated
      ? `<p class="tracehint">Showing the first ${frames.length.toLocaleString()} of ${explored.toLocaleString()} placements (capped to stay responsive).</p>`
      : "";
    view.innerHTML =
      `<div class="tracewrap">
        <div class="traceboard" id="tbBoard"></div>
        <div class="tracemeta">
          <p class="tracelabel" id="tbLabel"></p>
          <div class="legend tracelegend">
            <span><span class="swatch" style="background:var(--step1)"></span>block 1</span>
            <span><span class="swatch" style="background:var(--step2)"></span>block 2</span>
            <span><span class="swatch" style="background:var(--step3)"></span>block 3</span>
            <span><span class="swatch" style="box-shadow:0 0 0 2px var(--clear) inset;background:transparent"></span>about to clear</span>
            <span><span class="swatch" style="background:var(--clear);opacity:.32;filter:blur(1px)"></span>just cleared</span>
          </div>
          <input type="range" id="tbScrub" class="scrub" min="0" max="${frames.length - 1}" value="0" aria-label="Scrub through explored placements" />
          <div class="tracectrls">
            <button id="tbPlay" class="primary sm">▶ Play</button>
            <button id="tbStepB" class="sm" title="Previous placement" aria-label="Previous placement">‹</button>
            <button id="tbStepF" class="sm" title="Next placement" aria-label="Next placement">›</button>
            <button id="tbReset" class="sm" title="Back to start" aria-label="Back to start">⤺</button>
            <label class="speedlab">delay <input type="range" id="tbSpeed" min="0" max="400" step="5" value="40" aria-label="Delay between placements" /> <span id="tbSpeedVal"></span></label>
          </div>
          <p class="tracehint" id="tbEta"></p>
          ${trunc}
        </div>
      </div>`;
    const boardEl = $("#tbBoard");
    const cellEls = [];
    for (let r = 0; r < N; r++) {
      const row = [];
      for (let c = 0; c < N; c++) {
        const d = document.createElement("div");
        d.className = "tc";
        boardEl.appendChild(d);
        row.push(d);
      }
      cellEls.push(row);
    }
    const speed = $("#tbSpeed");
    player = {
      frames, idx: 0, playing: false, timer: null, delay: +speed.value, cellEls,
      playBtn: $("#tbPlay"), label: $("#tbLabel"), scrub: $("#tbScrub"),
      speedVal: $("#tbSpeedVal"), eta: $("#tbEta"),
    };
    updateSpeedLabel();
    tracePaint();

    $("#tbPlay").addEventListener("click", () => (player.playing ? tracePause() : tracePlay()));
    $("#tbStepF").addEventListener("click", () => { tracePause(); if (player.idx < frames.length - 1) { player.idx++; tracePaint(); } });
    $("#tbStepB").addEventListener("click", () => { tracePause(); if (player.idx > 0) { player.idx--; tracePaint(); } });
    $("#tbReset").addEventListener("click", () => { tracePause(); player.idx = 0; tracePaint(); });
    player.scrub.addEventListener("input", (e) => { tracePause(); player.idx = +e.target.value; tracePaint(); });
    speed.addEventListener("input", (e) => { player.delay = +e.target.value; updateSpeedLabel(); });
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
      hideTrace();
      return;
    }

    const traceOn = $("#traceToggle").checked;
    const t0 = performance.now();
    const res = solve(board, list, { trace: traceOn });
    const ms = performance.now() - t0;
    const steps = res.steps;

    if (res.placed === 0) {
      out.innerHTML = '<p class="note bad">No piece can be placed on this board at all.</p>';
      $("#applyBar").hidden = true;
      hideTrace();
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

    // Search visualizer: replay every explored placement, or tear it down.
    if (traceOn && res.trace && res.trace.length) {
      markAccepted(res.trace, steps);
      buildTracePlayer(res.trace, res.traceTruncated, res.explored);
      $("#tracePanel").hidden = false;
    } else {
      hideTrace();
    }
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

    // Search-visualizer toggle: remember the choice; tear the player down when off.
    const traceToggle = $("#traceToggle");
    traceToggle.checked = localStorage.getItem(TRACE_KEY) === "1";
    traceToggle.addEventListener("change", () => {
      localStorage.setItem(TRACE_KEY, traceToggle.checked ? "1" : "0");
      if (!traceToggle.checked) hideTrace();
    });

    // Keyboard shortcut: Ctrl/Cmd+Enter solves.
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); solveNow(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
