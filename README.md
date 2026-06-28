# Block Blast Solver

Draw your 8×8 board and your three pieces, hit **Solve**, and get the optimal
plan — the placement that fits the most pieces and clears the most lines. It
runs entirely in your browser: no accounts, no network, no tracking.

![Block Blast Solver](assets/icon.svg)

## Features

- **Optimal solver** — exhaustive search over every order and position; picks the
  plan that places the most pieces, then clears the most lines.
- **Works everywhere** — mouse, touch, and pen drag-painting (Pointer Events),
  plus full keyboard control (arrow keys to move, Space/Enter to toggle).
- **Step-by-step solution** — each move shows the placement and the resulting
  board, with "just placed" and "about to clear" highlighting.
- **Carry forward** — apply the solved result as your new board for the next round.
- **Light & dark themes** — follows your system preference, with a manual toggle.
- **Offline-ready PWA** — installable, works with no connection.
- **Persistent** — your board and pieces survive a refresh (localStorage).
- **Tested** — the solver core has a unit-test suite that runs in Node and the browser.

## Run it

It's a static site with **no build step**.

```bash
# Any static server works. Two convenient options:
npm start          # serves on http://localhost:5173 via `serve`
npm run dev        # serves on http://localhost:5173 via python3
```

You can also just open `index.html` directly in a browser. (A server is only
needed for the installable/offline PWA bits; the solver itself works from
`file://`.)

## Test

```bash
npm test                      # runs the solver suite in Node
# or open tests/index.html in a browser for the visual report
```

## Project structure

```
index.html              Semantic markup, loads the modules
assets/
  styles.css            Design system: tokens, light/dark, responsive
  icon.svg              App icon (used by favicon + PWA manifest)
js/
  solver.js             Pure solving engine — zero DOM, fully testable
  app.js                UI layer — rendering, input, persistence, theming
tests/
  solver.test.js        Unit tests (Node + browser)
  index.html            Visual test report
sw.js                   Service worker (offline caching)
manifest.webmanifest    PWA manifest
```

## Architecture notes

The solver is deliberately isolated from the DOM so it can be unit-tested,
reused in a Web Worker, or run server-side. The UI layer owns all rendering,
input handling, persistence, and theming. There are no inline event handlers
and no `eval`/JSON-in-attributes, which keeps the app
[Content-Security-Policy](https://developer.mozilla.org/docs/Web/HTTP/CSP)-friendly.

Search is `O((N²)^k)` worst case for `k` pieces, but `k ≤ 3`, so it completes in
well under a millisecond. The on-screen "explored placements" counter reports the
real work done.

## License

MIT
