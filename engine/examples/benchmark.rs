//! cargo run --release --example benchmark -- [simulations] [games-per-baseline]
//! Throughput is measured natively, not a promise about browser performance.
//! With games > 0, colors alternate between the tested AI and each baseline.

use konverson_engine::rules::{alliance, color, Game};
use konverson_engine::search::Search;
use std::time::Instant;

fn random(seed: &mut u64) -> u64 {
    *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *seed
}

fn greedy(game: &Game) -> usize {
    let mut best = None;
    let mut best_score = f64::NEG_INFINITY;
    for index in game.legal_moves() {
        let mut child = game.clone();
        child.play_fast(index).unwrap();
        if child.result.as_ref().and_then(|r| r.winner).is_some_and(|w| alliance(w) == alliance(game.active)) {
            return index;
        }
        let converted = game.cells.iter().zip(&child.cells).filter(|(a, b)| color(**a) != 0 && color(**a) != color(**b)).count();
        let row = index / game.size;
        let col = index % game.size;
        let mut friendly = 0;
        for dr in -1isize..=1 {
            for dc in -1isize..=1 {
                if dr == 0 && dc == 0 { continue; }
                let r = row as isize + dr;
                let c = col as isize + dc;
                if r >= 0 && c >= 0 && r < game.size as isize && c < game.size as isize
                    && color(game.cells[r as usize * game.size + c as usize]) == game.active { friendly += 1; }
            }
        }
        let score = converted as f64 * 2.0 + friendly as f64;
        if score > best_score { best = Some(index); best_score = score; }
    }
    best.unwrap()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let simulations: u32 = args.get(1).and_then(|v| v.parse().ok()).unwrap_or(1_000);
    let games: usize = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(0);
    for size in [9, 11, 13, 15] {
        let mut game = Game::new(size);
        let mut seed = 12345;
        for _ in 0..size * 2 {
            if game.result.is_some() { break; }
            let legal = game.legal_moves();
            let chosen = legal[(random(&mut seed) % legal.len() as u64) as usize];
            game.play_fast(chosen).unwrap();
        }
        if game.result.is_some() { game = Game::new(size); }
        let start = Instant::now();
        let mut search = Search::new(game, 887766, 100_000);
        let setup = start.elapsed();
        let start = Instant::now();
        search.step(simulations);
        let elapsed = start.elapsed();
        let report = search.report();
        println!("{size}x{size}: setup={:.2}ms simulations={} time={:.2}ms rate={:.0}/s nodes={} memory={}KiB immediate={:?}",
            setup.as_secs_f64() * 1000.0, report.simulations, elapsed.as_secs_f64() * 1000.0,
            report.simulations as f64 / elapsed.as_secs_f64(), report.nodes, report.memory_bytes / 1024, report.immediate_win);
    }
    for opponent in ["random", "greedy"] {
        let mut wins = 0;
        let mut draws = 0;
        let mut total_placements = 0;
        let start = Instant::now();
        for game_number in 0..games {
            let ai_alliance = (game_number % 2) as u8;
            let mut game = Game::new(9);
            let mut seed = 42 + game_number as u64 * 1009;
            while game.result.is_none() {
                let chosen = if alliance(game.active) == ai_alliance {
                    let mut search = Search::new(game.clone(), random(&mut seed), 50_000);
                    search.step(simulations);
                    search.report().best.unwrap()
                } else if opponent == "greedy" { greedy(&game) }
                else { let legal = game.legal_moves(); legal[(random(&mut seed) % legal.len() as u64) as usize] };
                game.play_fast(chosen).unwrap();
                assert!(game.placements <= 81, "occupancy must strictly increase");
            }
            total_placements += game.placements;
            match game.result.as_ref().unwrap().winner {
                None => draws += 1,
                Some(winner) if alliance(winner) == ai_alliance => wins += 1,
                _ => {}
            }
        }
        if games > 0 {
            println!("9x9 vs {opponent}: games={games} wins={wins} draws={draws} losses={} placements={total_placements} elapsed={:.2}s simulations/placement={simulations}",
                games - wins - draws, start.elapsed().as_secs_f64());
        }
    }
}
