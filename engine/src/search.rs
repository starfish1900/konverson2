//! Bounded root-parallel MCTS. Rewards always use the A/C alliance perspective.
//!
//! Each browser worker owns an independent Search. Reports contain real visit
//! counts (no pseudo-counts) and cumulative A/C rewards, suitable for summing
//! across workers. Call step in small batches; browser deadlines live outside
//! this pure, deterministic engine.

use crate::rules::{alliance, color, is_new, Game};
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::mem::size_of;
use wasm_bindgen::prelude::*;

const NONE: u32 = u32::MAX;
const MAX_CELLS: usize = 225;
const ROLLOUT_PLACEMENTS: usize = 8;
const UCT_EXPLORATION: f32 = 1.05;

#[derive(Clone, Copy)]
struct Node {
    first_child: u32,
    next_sibling: u32,
    visits: u32,
    value_sum: f32,
    move_index: u16,
    child_count: u16,
    prior: f32,
}

impl Node {
    fn new(index: usize, prior: f32) -> Self {
        Self { first_child: NONE, next_sibling: NONE, visits: 0, value_sum: 0.0,
            move_index: index as u16, child_count: 0, prior }
    }
}

/// Small, explicitly seeded PRNG with no dependence on wall-clock time.
/// Search reproducibility is tested for a fixed build/target; floating-point
/// evaluation need not be bit-identical across native and browser runtimes.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn unit(&mut self) -> f32 { ((self.next() >> 40) as u32) as f32 / 16_777_216.0 }
    fn index(&mut self, n: usize) -> usize { (self.next() % n as u64) as usize }
}

struct Geometry {
    neighbors: [[u16; 8]; MAX_CELLS],
    count: [u8; MAX_CELLS],
    // 0 corner, 1 border, 2 preborder, 3 interior.
    region: [u8; MAX_CELLS],
}
impl Geometry {
    fn new(size: usize) -> Self {
        let mut result = Self { neighbors: [[0; 8]; MAX_CELLS], count: [0; MAX_CELLS], region: [0; MAX_CELLS] };
        for index in 0..size * size {
            let r = index / size;
            let c = index % size;
            let edge_r = r == 0 || r + 1 == size;
            let edge_c = c == 0 || c + 1 == size;
            result.region[index] = if edge_r && edge_c { 0 } else if edge_r || edge_c { 1 }
                else if r == 1 || c == 1 || r + 2 == size || c + 2 == size { 2 } else { 3 };
            for dr in -1isize..=1 {
                for dc in -1isize..=1 {
                    if dr == 0 && dc == 0 { continue; }
                    let nr = r as isize + dr;
                    let nc = c as isize + dc;
                    if nr >= 0 && nc >= 0 && nr < size as isize && nc < size as isize {
                        let slot = result.count[index] as usize;
                        result.neighbors[index][slot] = (nr as usize * size + nc as usize) as u16;
                        result.count[index] += 1;
                    }
                }
            }
        }
        result
    }
    fn neighbors(&self, index: usize) -> impl Iterator<Item = usize> + '_ {
        self.neighbors[index][..self.count[index] as usize].iter().map(|&i| i as usize)
    }
}

struct EvaluationScratch {
    costs: [u16; MAX_CELLS],
    distance: [u16; MAX_CELLS],
    heap: BinaryHeap<Reverse<(u16, u16)>>,
}
impl EvaluationScratch {
    fn new() -> Self {
        Self { costs: [0; MAX_CELLS], distance: [0; MAX_CELLS], heap: BinaryHeap::with_capacity(512) }
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MoveReport {
    pub index: usize,
    pub visits: u32,
    /// Sum of A/C rewards, even when B/D is the alliance choosing the move.
    pub value_sum: f64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchReport {
    pub simulations: u64,
    pub nodes: usize,
    /// Estimated owned engine storage, not the entire worker/WASM process size.
    pub memory_bytes: usize,
    pub moves: Vec<MoveReport>,
    pub best: Option<usize>,
    pub immediate_win: Option<usize>,
}

pub struct Search {
    root: Game,
    scratch: Option<Game>,
    nodes: Vec<Node>,
    max_nodes: usize,
    root_legal: Vec<usize>,
    root_prior: [f32; MAX_CELLS],
    legal: Vec<usize>,
    geometry: Geometry,
    evaluation: EvaluationScratch,
    rng: Rng,
    simulations: u64,
    immediate_win: Option<usize>,
    fallback: Option<usize>,
}

impl Search {
    pub fn new(game: Game, seed: u64, max_nodes: usize) -> Self {
        let geometry = Geometry::new(game.size);
        let root_legal = if game.result.is_none() { game.legal_moves() } else { Vec::new() };
        let max_nodes = max_nodes.clamp(1, 2_000_000);
        let mut nodes = Vec::with_capacity(max_nodes);
        nodes.push(Node::new(0, 0.0));
        let mut root_prior = [0.0; MAX_CELLS];
        let mut immediate_win = None;
        let mut fallback = None;
        let mut fallback_score = f32::NEG_INFINITY;
        let mut probe = game.clone();
        // Exhaustive immediate-win detection at the root, before any pruning.
        for &index in &root_legal {
            copy_game(&game, &mut probe);
            if probe.play_fast(index).is_ok() {
                if probe.result.as_ref().and_then(|outcome| outcome.winner)
                    .is_some_and(|winner| alliance(winner) == alliance(game.active)) {
                    immediate_win.get_or_insert(index);
                }
            }
            let prior = move_priority(&game, index, &geometry);
            root_prior[index] = prior;
            if prior > fallback_score { fallback_score = prior; fallback = Some(index); }
        }
        // Detect the next opposing color's immediate threats on this board.
        // These are move-ordering hints, not proofs that a move is mandatory:
        // two-placement turns and conversions can provide other defenses.
        if immediate_win.is_none() && !root_legal.is_empty() {
            copy_game(&game, &mut probe);
            probe.active = game.active % 4 + 1;
            probe.stage = 0;
            probe.first = None;
            probe.opening = false;
            for cell in &mut probe.cells {
                if color(*cell) == probe.active { *cell = probe.active; }
            }
            let opponent = probe.clone();
            let opponent_legal = opponent.legal_moves();
            for index in opponent_legal {
                copy_game(&opponent, &mut probe);
                if probe.play_fast(index).is_ok() && probe.result.as_ref()
                    .and_then(|outcome| outcome.winner)
                    .is_some_and(|winner| alliance(winner) != alliance(game.active)) {
                    root_prior[index] += 12.0;
                }
            }
            fallback = root_legal.iter().copied().max_by(|&a, &b| root_prior[a].total_cmp(&root_prior[b]).then_with(|| b.cmp(&a)));
        }
        Self { scratch: Some(game.clone()), root: game, nodes, max_nodes, root_legal,
            root_prior, legal: Vec::with_capacity(MAX_CELLS), geometry,
            evaluation: EvaluationScratch::new(), rng: Rng(seed), simulations: 0,
            immediate_win, fallback }
    }

    /// Execute a bounded number of simulations. Each simulation visits at most
    /// 225 tree edges and makes at most eight additional rollout placements.
    pub fn step(&mut self, iterations: u32) {
        if self.root_legal.is_empty() || self.immediate_win.is_some() { return; }
        let mut game = self.scratch.take().expect("search scratch exists");
        let mut legal = std::mem::take(&mut self.legal);
        for _ in 0..iterations {
            copy_game(&self.root, &mut game);
            let mut path = [0u32; MAX_CELLS + 1];
            let mut path_len = 1usize;
            let mut node_index = 0usize;
            while game.result.is_none() && path_len <= MAX_CELLS {
                game.legal_moves_into(&mut legal);
                if legal.is_empty() { break; }
                let node = self.nodes[node_index];
                let width = (2.0 + 1.5 * (node.visits as f32).sqrt()) as usize;
                let expand = (node.child_count as usize) < width.min(legal.len()) && self.nodes.len() < self.max_nodes;
                if expand {
                    let mut tried = [false; MAX_CELLS];
                    let mut child = node.first_child;
                    while child != NONE {
                        tried[self.nodes[child as usize].move_index as usize] = true;
                        child = self.nodes[child as usize].next_sibling;
                    }
                    // A uniform branch on 20% of expansions gives every legal
                    // unexpanded move positive probability, including distant ones.
                    let exploratory = self.rng.unit() < 0.20;
                    let mut choice = None;
                    let mut score = f32::NEG_INFINITY;
                    let mut available = 0usize;
                    for &index in &legal {
                        if tried[index] { continue; }
                        available += 1;
                        if exploratory {
                            if self.rng.index(available) == 0 { choice = Some(index); }
                        } else {
                            let prior = if node_index == 0 { self.root_prior[index] }
                                else { move_priority(&game, index, &self.geometry) };
                            let candidate = prior + self.rng.unit() * 1.25;
                            if candidate > score { score = candidate; choice = Some(index); }
                        }
                    }
                    if let Some(index) = choice {
                        let prior = if node_index == 0 { self.root_prior[index] }
                            else { move_priority(&game, index, &self.geometry) };
                        if game.play_fast(index).is_err() { break; }
                        let new_index = self.nodes.len() as u32;
                        let mut new_node = Node::new(index, prior / (4.0 + prior.abs()));
                        new_node.next_sibling = self.nodes[node_index].first_child;
                        self.nodes.push(new_node);
                        self.nodes[node_index].first_child = new_index;
                        self.nodes[node_index].child_count += 1;
                        path[path_len] = new_index;
                        path_len += 1;
                        break;
                    }
                }
                if node.first_child == NONE { break; }
                let ac_to_move = alliance(game.active) == alliance(1);
                let log_parent = ((node.visits as f32) + 1.0).ln();
                let mut selected = node.first_child;
                let mut best_score = f32::NEG_INFINITY;
                let mut child = node.first_child;
                while child != NONE {
                    let candidate = self.nodes[child as usize];
                    let value = selection_score(candidate, ac_to_move, log_parent);
                    if value > best_score { best_score = value; selected = child; }
                    child = candidate.next_sibling;
                }
                let index = self.nodes[selected as usize].move_index as usize;
                if game.play_fast(index).is_err() { break; }
                node_index = selected as usize;
                path[path_len] = selected;
                path_len += 1;
            }
            if game.result.is_none() {
                for _ in 0..ROLLOUT_PLACEMENTS {
                    game.legal_moves_into(&mut legal);
                    if legal.is_empty() { break; }
                    // Sample at most 12 candidates without replacement; full
                    // board scans or shortest paths per candidate are avoided.
                    let count = legal.len().min(12);
                    let mut choice = legal[0];
                    let mut best = f32::NEG_INFINITY;
                    for i in 0..count {
                        let j = i + self.rng.index(legal.len() - i);
                        legal.swap(i, j);
                        let candidate = legal[i];
                        let score = move_priority(&game, candidate, &self.geometry) + self.rng.unit() * 2.0;
                        if score > best { best = score; choice = candidate; }
                    }
                    if game.play_fast(choice).is_err() || game.result.is_some() { break; }
                }
            }
            let reward = evaluate(&game, &self.geometry, &mut self.evaluation);
            // No sign alternation here: consecutive placements belong to the
            // same alliance, and rewards always describe A/C's outcome.
            for &index in &path[..path_len] {
                let node = &mut self.nodes[index as usize];
                node.visits = node.visits.saturating_add(1);
                node.value_sum += reward;
            }
            self.simulations += 1;
        }
        self.scratch = Some(game);
        self.legal = legal;
    }

    pub fn report(&self) -> SearchReport {
        let mut visits = [0u32; MAX_CELLS];
        let mut sums = [0f32; MAX_CELLS];
        let mut child = self.nodes[0].first_child;
        while child != NONE {
            let node = self.nodes[child as usize];
            visits[node.move_index as usize] = node.visits;
            sums[node.move_index as usize] = node.value_sum;
            child = node.next_sibling;
        }
        let ac_to_move = alliance(self.root.active) == alliance(1);
        let moves: Vec<_> = self.root_legal.iter().map(|&index| MoveReport {
            index, visits: visits[index], value_sum: sums[index] as f64,
        }).collect();
        let best = self.immediate_win.or_else(|| {
            moves.iter().filter(|m| m.visits > 0).max_by(|a, b| {
                a.visits.cmp(&b.visits).then_with(|| {
                    let av = a.value_sum / a.visits as f64;
                    let bv = b.value_sum / b.visits as f64;
                    if ac_to_move { av.total_cmp(&bv) } else { bv.total_cmp(&av) }
                }).then_with(|| b.index.cmp(&a.index))
            }).map(|m| m.index)
        }).or(self.fallback);
        SearchReport { simulations: self.simulations, nodes: self.nodes.len(),
            memory_bytes: self.nodes.capacity() * size_of::<Node>() + size_of::<Self>()
                + self.root.cells.capacity() + self.scratch.as_ref().map_or(0, |g| g.cells.capacity())
                + (self.root_legal.capacity() + self.legal.capacity()) * size_of::<usize>()
                + self.evaluation.heap.capacity() * size_of::<Reverse<(u16, u16)>>(),
            moves, best, immediate_win: self.immediate_win }
    }
}

fn selection_score(node: Node, ac_to_move: bool, log_parent: f32) -> f32 {
    if node.visits == 0 { return f32::INFINITY; }
    let q = node.value_sum / node.visits as f32;
    let exploitation = if ac_to_move { q } else { 1.0 - q };
    exploitation + UCT_EXPLORATION * (log_parent / node.visits as f32).sqrt()
        + 0.20 * node.prior / (1.0 + node.visits as f32)
}

fn copy_game(from: &Game, into: &mut Game) {
    into.cells.clone_from(&from.cells);
    into.size = from.size;
    into.active = from.active;
    into.stage = from.stage;
    into.first = from.first;
    into.opening = from.opening;
    into.turn = from.turn;
    into.placements = from.placements;
    into.result.clone_from(&from.result);
}

fn move_priority(game: &Game, index: usize, geometry: &Geometry) -> f32 {
    let active = game.active;
    let mut own = 0u8;
    let mut allied = 0u8;
    let mut enemy = 0u8;
    for neighbor in geometry.neighbors(index) {
        let other = color(game.cells[neighbor]);
        if other == active { own += 1; }
        else if other != 0 && alliance(other) == alliance(active) { allied += 1; }
        else if other != 0 { enemy += 1; }
    }
    // Diminishing adjacency rewards avoid filling dense, unhelpful clusters.
    let mut score = match own { 0 => 0.0, 1 => 1.9, 2 => 2.8, 3 => 2.6, _ => 2.2 };
    score += allied.min(2) as f32 * 0.18 + enemy.min(2) as f32 * 0.12;
    let r = index / game.size;
    let c = index % game.size;
    if geometry.region[index] == 0 { score -= 1.8; }
    else if geometry.region[index] == 1 && own > 0 { score += 1.25; }
    else if geometry.region[index] == 2 && own > 0 { score += 0.6; }
    // Central development breaks empty-board ties without excluding edges.
    let center = (game.size - 1) as f32 * 0.5;
    score += 0.4 * (1.0 - ((r as f32 - center).abs() + (c as f32 - center).abs()) / game.size as f32);
    for (dr, dc) in [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)] {
        let mut nr = r as isize + dr;
        let mut nc = c as isize + dc;
        let mut captured_color = 0;
        let mut captured = 0usize;
        while nr >= 0 && nc >= 0 && nr < game.size as isize && nc < game.size as isize {
            let cell = game.cells[nr as usize * game.size + nc as usize];
            let other = color(cell);
            if other == active {
                if captured > 0 {
                    let factor = if alliance(captured_color) == alliance(active) { 0.30 } else { 1.65 };
                    score += factor * (captured as f32).sqrt();
                }
                break;
            }
            if other == 0 || is_new(cell) || (captured_color != 0 && other != captured_color) { break; }
            captured_color = other;
            captured += 1;
            nr += dr;
            nc += dc;
        }
    }
    score
}

fn evaluate(game: &Game, geometry: &Geometry, scratch: &mut EvaluationScratch) -> f32 {
    if let Some(outcome) = &game.result {
        return match outcome.winner { None => 0.5,
            Some(winner) if alliance(winner) == alliance(1) => 1.0, _ => 0.0 };
    }
    let mut distances = [0f32; 4];
    for wanted in 1..=4u8 {
        for index in 0..game.cells.len() {
            let cell = game.cells[index];
            let other = color(cell);
            scratch.costs[index] = if geometry.region[index] == 0 { u16::MAX }
                else if other == wanted { 0 }
                else if other != 0 && is_new(cell) { 7 }
                else if other != 0 && alliance(other) == alliance(wanted) { 3 }
                else if other != 0 { 4 }
                else {
                    let region = geometry.region[index];
                    let supported = region == 3 || geometry.neighbors(index)
                        .any(|n| geometry.region[n] == region + 1 && game.cells[n] != 0);
                    2 + if supported { 0 } else if region == 1 { 2 } else { 1 }
                };
        }
        let vertical = shortest_path(game.size, true, geometry, scratch);
        let horizontal = shortest_path(game.size, false, geometry, scratch);
        distances[(wanted - 1) as usize] = vertical.min(horizontal) as f32;
    }
    let ac_distance = distances[0].min(distances[2]) + 0.25 * distances[0].max(distances[2]);
    let bd_distance = distances[1].min(distances[3]) + 0.25 * distances[1].max(distances[3]);
    let mut material = 0.0;
    let mut vulnerability = 0.0;
    for (index, &cell) in game.cells.iter().enumerate() {
        let own = color(cell);
        if own == 0 { continue; }
        let sign = if alliance(own) == alliance(1) { 1.0 } else { -1.0 };
        material += sign * if is_new(cell) { 0.045 } else { 0.025 };
        if is_new(cell) { continue; }
        let r = index / game.size;
        let c = index % game.size;
        for (dr, dc) in [(0isize, 1isize), (1, 0), (1, 1), (1, -1)] {
            let ar = r as isize - dr; let ac = c as isize - dc;
            let br = r as isize + dr; let bc = c as isize + dc;
            if ar < 0 || ac < 0 || br < 0 || bc < 0 || ar >= game.size as isize || ac >= game.size as isize
                || br >= game.size as isize || bc >= game.size as isize { continue; }
            let a = color(game.cells[ar as usize * game.size + ac as usize]);
            let b = color(game.cells[br as usize * game.size + bc as usize]);
            let capturer = if a == 0 { b } else if b == 0 { a } else { 0 };
            if capturer != 0 && capturer != own {
                vulnerability -= sign * if alliance(capturer) != alliance(own) { 0.14 } else { 0.035 };
            }
        }
    }
    let advantage = bd_distance - ac_distance + material + vulnerability;
    0.5 + 0.48 * advantage / (8.0 + advantage.abs())
}

fn shortest_path(size: usize, vertical: bool, geometry: &Geometry, scratch: &mut EvaluationScratch) -> u16 {
    scratch.distance.fill(u16::MAX);
    scratch.heap.clear();
    for offset in 1..size - 1 {
        let index = if vertical { offset } else { offset * size };
        let cost = scratch.costs[index];
        scratch.distance[index] = cost;
        scratch.heap.push(Reverse((cost, index as u16)));
    }
    while let Some(Reverse((cost, raw_index))) = scratch.heap.pop() {
        let index = raw_index as usize;
        if scratch.distance[index] != cost { continue; }
        if (vertical && index / size == size - 1) || (!vertical && index % size == size - 1) { return cost; }
        for next in geometry.neighbors(index) {
            if scratch.costs[next] == u16::MAX { continue; }
            let next_cost = cost + scratch.costs[next];
            if next_cost < scratch.distance[next] {
                scratch.distance[next] = next_cost;
                scratch.heap.push(Reverse((next_cost, next as u16)));
            }
        }
    }
    // Opponent squares have finite heuristic costs, so supported sizes always
    // have a non-corner route. This is defensive, not a legal-game outcome.
    1024
}

#[wasm_bindgen]
pub struct SearchSession { inner: Search }

#[wasm_bindgen]
impl SearchSession {
    #[wasm_bindgen(constructor)]
    pub fn new(state_json: &str, seed: u32, max_nodes: u32) -> Result<SearchSession, JsValue> {
        let game = Game::from_json(state_json).map_err(|e| JsValue::from_str(&e))?;
        Ok(Self { inner: Search::new(game, seed as u64, max_nodes as usize) })
    }
    pub fn step(&mut self, iterations: u32) { self.inner.step(iterations); }
    pub fn report(&self) -> String { serde_json::to_string(&self.inner.report()).expect("search report serializes") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_search_is_deterministic_and_reports_legal_moves() {
        let game = Game::new(9);
        let mut a = Search::new(game.clone(), 1234, 512);
        let mut b = Search::new(game.clone(), 1234, 512);
        a.step(80);
        b.step(80);
        assert_eq!(serde_json::to_string(&a.report()).unwrap(), serde_json::to_string(&b.report()).unwrap());
        let report = a.report();
        assert_eq!(report.simulations, 80);
        assert!(game.legal_moves().contains(&report.best.unwrap()));
        assert!(report.moves.iter().all(|m| game.placement_error(m.index).is_none()));
        assert!(report.moves.iter().all(|m| m.value_sum >= 0.0 && m.value_sum <= m.visits as f64));
        assert_eq!(report.moves.iter().map(|m| m.visits as u64).sum::<u64>(), 80);
    }

    #[test]
    fn bounded_arena_continues_search_without_growing() {
        let mut search = Search::new(Game::new(9), 7, 9);
        search.step(100);
        assert_eq!(search.report().nodes, 9);
        assert_eq!(search.report().simulations, 100);
        let mut root_only = Search::new(Game::new(9), 7, 1);
        root_only.step(5);
        assert_eq!(root_only.report().nodes, 1);
        assert!(root_only.report().best.is_some());
    }

    #[test]
    fn same_alliance_keeps_value_perspective_between_placements() {
        let mut game = Game::new(9);
        game.opening = false;
        game.active = 2;
        game.play_fast(20).unwrap();
        assert_eq!(game.active, 2);
        assert_eq!(game.stage, 1);
        let good_for_ac = Node { visits: 10, value_sum: 9.0, ..Node::new(0, 0.0) };
        let good_for_bd = Node { visits: 10, value_sum: 1.0, ..Node::new(1, 0.0) };
        assert!(selection_score(good_for_bd, false, 1.0) > selection_score(good_for_ac, false, 1.0));
        assert!(selection_score(good_for_ac, true, 1.0) > selection_score(good_for_bd, true, 1.0));
    }

    #[test]
    fn immediate_connection_wins_are_found_for_either_alliance() {
        for active in [1, 2, 3, 4] {
            let mut game = Game::new(9);
            game.active = active;
            game.opening = false;
            for row in 0..9 { if row != 4 { game.cells[row * 9 + 4] = active; } }
            let search = Search::new(game.clone(), 4, 50);
            assert!(search.report().immediate_win.is_some());
            game.play_fast(search.report().best.unwrap()).unwrap();
            assert_eq!(game.result.unwrap().winner, Some(active));
        }
    }

    #[test]
    fn converted_allied_color_can_complete_current_colors_connection() {
        let mut game = Game::new(9);
        game.active = 1;
        game.opening = false;
        game.turn = 5;
        for row in 0..9 { if row != 4 { game.cells[row * 9 + 6] = 1; } }
        for col in 3..=7 { game.cells[4 * 9 + col] = 3; }
        game.cells[4 * 9 + 8] = 1;
        game.placements = game.cells.iter().filter(|&&cell| cell != 0).count() as u32;
        game.validate().unwrap();
        assert!((1..=4).all(|color| game.winning_path(color).is_none()));

        // The remote placement is too far from the vertical route to join it;
        // changing the allied gap at (4,6) is what produces the connexion.
        let mut remote = game.clone();
        remote.play_fast(38).unwrap();
        assert_eq!(remote.cells[42], 1);
        assert_eq!(remote.result.as_ref().unwrap().winner, Some(1));
        assert!(!remote.result.as_ref().unwrap().path.contains(&38));

        let search = Search::new(game.clone(), 100, 50);
        let chosen = search.report().immediate_win.expect("allied conversion win found");
        game.play_fast(chosen).unwrap();
        assert!(game.cells.iter().filter(|&&cell| color(cell) == 3).count() < 5);
        assert_eq!(game.result.as_ref().unwrap().winner, Some(1));
        assert!(!game.result.as_ref().unwrap().path.contains(&chosen));
    }

    #[test]
    fn connection_evaluation_does_not_merge_allied_colors_or_use_corners() {
        let mut game = Game::new(9);
        let geometry = Geometry::new(9);
        let mut scratch = EvaluationScratch::new();
        for row in 0..9 { game.cells[row * 9 + 4] = if row % 2 == 0 { 1 } else { 3 }; }
        let mixed = evaluate(&game, &geometry, &mut scratch);
        for row in 0..9 { game.cells[row * 9 + 4] = 1; }
        let single = evaluate(&game, &geometry, &mut scratch);
        assert!(single > mixed);
        for index in [0, 8, 72, 80] { assert_eq!(geometry.region[index], 0); }
    }

    #[test]
    fn terminal_game_has_no_search_move() {
        let mut game = Game::new(9);
        game.result = Some(crate::rules::Outcome { winner: None, path: vec![], orientation: None });
        let mut search = Search::new(game, 0, 100);
        search.step(10);
        assert!(search.report().best.is_none());
        assert_eq!(search.report().simulations, 0);
    }
}
