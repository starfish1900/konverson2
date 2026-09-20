# Konverson validation

Verified locally on Windows on 20 September 2026. The application has not been published to a Render account.

## Automated checks

| Layer | Result |
|---|---|
| Rust rules and search | 36 tests passed: 29 rules, 7 search |
| Worker lifecycle and aggregation | 14 tests passed |
| Browser behavior | 7 scenarios passed in each of Chromium, Firefox and WebKit |
| Production bundle | Asset loading and actual worker gameplay passed in all three engines |
| Type checking and full release build | Passed |

Browser scenarios cover the opening, AI replies, second-placement distance, all board sizes, keyboard input, settings, rules, conversion postures, conversion-created victory, mobile zoom, reduced motion, identical-opening restarts, cancellation, hidden-tab pause/resume, and complete games. Production checks verify the WASM MIME type and confirm the development fixture loader is absent.

Rust tests also run 20 complete randomized games across all board sizes, validating every state and checking equivalence between the event-producing UI transition and the lean AI transition. Imported live states and draws cannot contain an existing unreported connexion. Native and browser tests are performed on the same Rust rules source compiled for their respective targets.

The original installed Firefox could not launch because of a Windows assembly activation error. A fresh isolated Playwright Firefox installation ran all tests successfully; no global browser files were changed.

## Browser multithreading measurement

Chromium 153.0.8010.12 reported 24 logical processors. Each measurement searched for 1,000 ms after worker initialization and a 250 ms warmup, using the same prepared position for each worker count at a given board size. Reported values are completed simulations, approximately simulations per second.

| Board | 1 worker | 2 workers | 4 workers | 23 workers |
|---|---:|---:|---:|---:|
| 9×9 | 17,910 | 36,250 | 71,937 | 253,150 |
| 11×11 | 13,801 | 27,663 | 53,820 | 189,119 |
| 13×13 | 11,888 | 23,759 | 47,402 | 156,760 |
| 15×15 | 9,492 | 18,672 | 37,852 | 123,164 |

All requested workers contributed simulations in all 16 samples. All selected moves were legal. Measured search durations ranged from 1,000.0 to 1,000.8 ms. Peak estimated aggregate engine-owned search storage was approximately 254.78 MiB; browser, WASM-instance and UI overhead are additional. Other local workloads can affect throughput. These are observed results on this machine, not promises of linear scaling or identical performance on other devices.

The complete measurements, positions and per-worker counts are in `validation/browser-benchmark.json`. To repeat, start `npm run dev` in one terminal and run `npm run benchmark` in another. `KONVERSON_BENCHMARK_URL` changes the dev-server URL; `KONVERSON_BENCHMARK_OUTPUT` changes the output file. Run the benchmark without other heavy workloads for cleaner comparisons.

## Basic playing-strength measurement

Native release engine; 9×9 board; 1,000 simulations per AI placement; AI alternates alliances over 20 seeded games against each baseline.

| Opponent | AI wins | Draws | AI losses |
|---|---:|---:|---:|
| Random legal placement | 20 | 0 | 0 |
| Greedy conversion/adjacency | 19 | 0 | 1 |

The greedy baseline takes an immediate win if available; otherwise it maximizes twice the conversion count plus adjacent own-color pawns. Ties use legal-move enumeration order. The sample demonstrates basic strategic competence; it does not establish expert strength or an Elo rating.

Reproduce with:

```sh
cargo run --release --manifest-path engine/Cargo.toml --example benchmark -- 1000 20
```

The match seed is `42 + 1009 * gameIndex`, with indices 0–19; search node cap is 50,000. The deterministic native harness records its PRNG and baseline implementation in `engine/examples/benchmark.rs`. Reproducibility applies to a fixed build and target; floating-point math can differ between native and WASM targets.

## Production checks

Build with `npm run build`, then serve with `node scripts/serve.mjs`. With the server running, set `KONVERSON_PRODUCTION=1` and `KONVERSON_TEST_URL=http://127.0.0.1:4173`, then run `npm run test:e2e` to execute production smoke tests.

The Render Blueprint and Linux build script are included. An actual Render build/deployment requires connecting the user's Git repository and Render account and has not been performed. No migrations or server services are needed. The delivered static production files were tested locally using the same worker and WASM assets intended for deployment.
