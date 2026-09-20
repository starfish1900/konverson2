# Konverson

A complete human-versus-computer implementation of **Konverson — The Game of Connexions & Conversions**, with the clarified XaXua Games rules, four board sizes, a responsive dark interface, animated conversions and winning connexions, and a Rust/WebAssembly AI running in parallel browser workers.

## Play locally first

The delivery includes a ready-built `dist` folder. **You do not need Rust, a Render account, or an internet connection to play this build.** Node.js is needed only to serve the files locally.

On Windows, double-click **Start Konverson.cmd**, then open **http://127.0.0.1:4173/**. Keep its window open while playing. Or run this command from the project folder:

```sh
node scripts/serve.mjs
```

The server listens only on your own computer. Opening `dist/index.html` directly is not supported because browsers load WebAssembly and workers through HTTP.

## Development

Requirements: Node.js 24 LTS (tested with 24.14.0), npm, and Rust 1.98.1 installed with rustup. Windows Rust compilation also needs the Visual Studio C++ build tools. These are not needed to play the supplied build.

```sh
npm ci
rustup target add wasm32-unknown-unknown
npm run build:wasm
npm run dev
```

Open the local address printed by Vite. Interface edits update automatically. After editing Rust, rerun `npm run build:wasm`.

For a complete production build:

```sh
npm run build
node scripts/serve.mjs
```

`package-lock.json`, `engine/Cargo.lock`, and `rust-toolchain.toml` pin the dependencies/toolchain. `wasm-pack` is installed as a project dependency. The optional `KONVERSON_RUST_HOME` environment variable points to a portable directory containing `cargo/` and `rustup/`; it is only needed for a workspace-local compiler installation.

## Publish on Render

1. Test the app locally.
2. Put the project source in your own GitHub or GitLab repository. Exclude `node_modules`, `engine/target`, generated WASM folders, local toolchains, and test artifacts as specified in `.gitignore`.
3. On Render, choose **New → Blueprint** and connect that repository. The included `render.yaml` defines a **Static Site**. Review the configuration and deploy when ready.
4. Alternatively, choose **New → Static Site** and enter:

| Setting | Value |
|---|---|
| Build command | `bash scripts/render-build.sh` |
| Publish directory | `dist` |
| Node version environment variable | `NODE_VERSION=24.14.0` |
| Disable duplicate automatic dependency install | `SKIP_INSTALL_DEPS=true` |

The build script provisions the pinned Rust compiler and WASM target in the build environment, installs npm dependencies, and creates the complete production app. There is **no server process, database, API secret, or paid AI service**. Each visitor's device supplies the AI computation. The Blueprint starts with automatic deploys disabled so you control when to publish subsequent changes; enable them in Render if desired.

The app uses one route and does not need an SPA catch-all rewrite. JavaScript, fonts, workers, and WASM are all same-origin assets. The Blueprint adds cache headers and the WASM content type; no cross-origin isolation headers are required.

Static sites can use Render's free hosting within the account's included bandwidth and build-minute allowances. Check current quotas in the Render dashboard. This delivery does not create a remote repository or publish to a Render account.

## Game controls

- **New game:** choose 9×9, 11×11, 13×13, or 15×15; choose A/C or B/D; and select a difficulty.
- **Difficulty:** Casual 1s, Standard 3s, Strong 10s, Deep 30s of total thinking per color turn. Animations are additional. First placement gets 60%, second gets the remaining budget; unused time carries forward.
- **Settings:** show/hide pawn letters and placement guides, or reduce the number of AI workers.
- **Board:** click or tap a legal square. Arrow keys navigate; Enter/Space places. Zoom controls help with large boards on smaller screens. Invalid-square clicks explain the relevant restriction.
- **Restart:** clears the current match after an in-app confirmation. New matches and restarts cancel prior animation/search work.
- **Reduced motion:** follows the device preference automatically.

Preferences for labels, guides and worker count stay in this browser. Match state is not saved across page reloads. AI computation pauses while the tab is hidden and workers are idle during human turns.

## Architecture

- `engine/`: authoritative Rust rules, state validation, exact winning-path detection and heuristic-guided MCTS. Pure native tests and a reproducible baseline benchmark are included.
- `src/`: React presentation; an engine bridge; persistent independent WASM workers; exact search identity, cancellation and aggregate reporting.
- `tests/`: worker lifecycle/aggregation tests plus Playwright scenarios for all three browser engines.

Cells use `0` for empty, `1..4` for old A..D, and bit `8` for NEW posture. State includes color, turn phase, first placement, opening exception and outcome. Conversion events are emitted by the engine; the UI never independently calculates captures or victories.

Each worker runs an independent MCTS tree. A/C reward is held fixed throughout the tree; B/D decisions invert exploitation, and the two placements of a color do not incorrectly alternate the player. Candidate widening preserves access to the complete legal move set. Evaluation considers individual-color paths, immunity, pincer risks and border access. Sessions start a fresh tree for each placement.

Default worker count is `max(1, navigator.hardwareConcurrency - 1)`. Browser-reported processors may be fewer than actual machine processors. The aggregate search-node allocation target is 256 MiB; browser, WASM-instance and interface overhead are additional. Worker failure reduces available capacity; total failure presents a retry action. The AI is a search algorithm, not a trained neural network or remote API.

## Tests and benchmarks

```sh
npm run test:rules
npm test
npx playwright install
npm run test:e2e
npm run benchmark
```

The browser suite starts/reuses a Vite server on port 5173. Its opt-in fixture loader exists only in development at `/?test`; production bundles remove it. `KONVERSON_TEST_URL` can override the dev server address. Browser benchmark instructions and measured results are in `VALIDATION.md`.

The document's confirmed rule interpretations are recorded in `RULES.md`. The original game rules are credited to XaXua Games. Third-party libraries retain their own licenses. No additional license for the game name or rules is granted by this source package.
