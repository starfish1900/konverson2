use serde::{Deserialize, Serialize};

pub const SUPPORTED_SIZES: [usize; 4] = [9, 11, 13, 15];
pub const NEW: u8 = 8;
const MAX_CELLS: usize = 225;
const DIRECTIONS: [(isize, isize); 8] = [
    (-1, -1), (-1, 0), (-1, 1), (0, -1),
    (0, 1), (1, -1), (1, 0), (1, 1),
];

#[inline]
pub fn color(cell: u8) -> u8 { cell & 7 }

#[inline]
pub fn is_new(cell: u8) -> bool { cell & NEW != 0 }

#[inline]
pub fn alliance(pawn_color: u8) -> u8 { (pawn_color - 1) % 2 }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outcome {
    pub winner: Option<u8>,
    pub path: Vec<usize>,
    pub orientation: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub kind: String,
    pub color: u8,
    pub indices: Vec<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Game {
    pub size: usize,
    pub cells: Vec<u8>,
    pub active: u8,
    pub stage: u8,
    pub first: Option<usize>,
    pub opening: bool,
    pub turn: u32,
    pub placements: u32,
    pub result: Option<Outcome>,
}

impl Game {
    /// Native construction; browser callers validate the size before entering.
    pub fn new(size: usize) -> Self {
        assert!(SUPPORTED_SIZES.contains(&size), "Unsupported board size");
        Self {
            size, cells: vec![0; size * size], active: 1, stage: 0,
            first: None, opening: true, turn: 1, placements: 0, result: None,
        }
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        let state: Self = serde_json::from_str(json)
            .map_err(|e| format!("Invalid game data: {e}"))?;
        state.validate()?;
        Ok(state)
    }

    /// Checks the public state boundary without attempting to replay its history.
    pub fn validate(&self) -> Result<(), String> {
        if !SUPPORTED_SIZES.contains(&self.size) { return Err("Board size must be 9, 11, 13, or 15.".into()); }
        if self.cells.len() != self.size * self.size { return Err("The board has the wrong number of squares.".into()); }
        if self.cells.iter().any(|&v| !matches!(v, 0..=4 | 9..=12)) { return Err("The board contains an invalid pawn.".into()); }
        if !(1..=4).contains(&self.active) { return Err("The active color must be A, B, C, or D.".into()); }
        if self.stage > 1 { return Err("The placement stage must be zero or one.".into()); }
        if self.turn == 0 || self.turn > self.placements.saturating_add(1) { return Err("The turn counter is inconsistent.".into()); }
        if self.active != ((self.turn - 1) % 4 + 1) as u8 { return Err("The active color does not match the turn counter.".into()); }
        let occupied = self.cells.iter().filter(|&&v| v != 0).count();
        if self.placements as usize != occupied { return Err("The placement counter does not match the board.".into()); }
        if self.stage == 0 && self.first.is_some() { return Err("A first-placement stage cannot retain a previous first square.".into()); }
        if self.stage == 1 {
            let first = self.first.ok_or("The second-placement stage requires a first square.")?;
            if first >= self.cells.len() || self.cells[first] != self.active | NEW {
                return Err("The first square must contain this turn's new pawn.".into());
            }
            if self.opening { return Err("The opening turn has only one placement.".into()); }
        }
        if self.opening && (self.turn != 1 || self.placements != 0 || self.stage != 0 || self.result.is_some()) {
            return Err("The opening flag is only valid on the initial empty board.".into());
        }
        if !self.opening && self.turn == 1 { return Err("The first turn must be the opening turn.".into()); }
        for c in 1..=4 {
            if self.cells.iter().filter(|&&v| v == c | NEW).count() > 2 {
                return Err("A color cannot have more than two new pawns.".into());
            }
        }
        if let Some(result) = &self.result {
            match result.winner {
                Some(winner) => {
                    if !(1..=4).contains(&winner) || winner != self.active {
                        return Err("The winning color is invalid.".into());
                    }
                    self.validate_path(result, winner)?;
                }
                None => {
                    if !result.path.is_empty() || result.orientation.is_some() || self.stage != 0 {
                        return Err("A draw cannot contain a winning path or pending second placement.".into());
                    }
                    if (0..self.cells.len()).any(|i| self.base_legal(i)) {
                        return Err("A no-connexion draw still has a legal placement.".into());
                    }
                    if (1..=4).any(|c| self.winning_path(c).is_some()) {
                        return Err("A no-connexion draw cannot contain a connexion.".into());
                    }
                }
            }
        } else {
            let active_new = self.cells.iter().filter(|&&v| v == self.active | NEW).count();
            if active_new != self.stage as usize { return Err("New pawns do not match the current placement stage.".into()); }
            if self.legal_moves().is_empty() { return Err("A live game must have a legal placement.".into()); }
            if (1..=4).any(|c| self.winning_path(c).is_some()) {
                return Err("A game with a connexion must already be finished.".into());
            }
        }
        Ok(())
    }

    fn validate_path(&self, outcome: &Outcome, winner: u8) -> Result<(), String> {
        let orientation = outcome.orientation.as_deref().ok_or("A winning path requires an orientation.")?;
        if outcome.path.is_empty() || !matches!(orientation, "north-south" | "west-east") {
            return Err("The winning path is invalid.".into());
        }
        let mut seen = [false; MAX_CELLS];
        for (position, &i) in outcome.path.iter().enumerate() {
            if i >= self.cells.len() || self.is_corner(i) || color(self.cells[i]) != winner || seen[i] {
                return Err("The winning path contains an invalid square.".into());
            }
            seen[i] = true;
            if position > 0 && self.distance(i, outcome.path[position - 1]) != 1 {
                return Err("The winning path is not connected.".into());
            }
        }
        let first = outcome.path[0];
        let last = *outcome.path.last().unwrap();
        let spans = if orientation == "north-south" {
            first / self.size == 0 && last / self.size == self.size - 1
        } else {
            first % self.size == 0 && last % self.size == self.size - 1
        };
        if !spans { return Err("The winning path does not join opposite sides.".into()); }
        Ok(())
    }

    #[inline]
    pub fn distance(&self, a: usize, b: usize) -> usize {
        (a / self.size).abs_diff(b / self.size).max((a % self.size).abs_diff(b % self.size))
    }

    #[inline]
    pub fn is_corner(&self, index: usize) -> bool {
        let r = index / self.size;
        let c = index % self.size;
        (r == 0 || r == self.size - 1) && (c == 0 || c == self.size - 1)
    }

    #[inline]
    fn ring(&self, index: usize) -> usize {
        let r = index / self.size;
        let c = index % self.size;
        r.min(c).min(self.size - 1 - r).min(self.size - 1 - c)
    }

    #[inline]
    fn step(&self, index: usize, dr: isize, dc: isize) -> Option<usize> {
        let row = index / self.size;
        let col = index % self.size;
        let r = row as isize + dr;
        let c = col as isize + dc;
        (r >= 0 && c >= 0 && r < self.size as isize && c < self.size as isize)
            .then_some((r.max(0) as usize) * self.size + c.max(0) as usize)
    }

    #[inline]
    fn has_support(&self, index: usize) -> bool {
        let ring = self.ring(index);
        if ring >= 2 { return true; }
        DIRECTIONS.iter().any(|&(dr, dc)| {
            self.step(index, dr, dc).is_some_and(|next| {
                self.cells[next] != 0 && if ring == 0 {
                    self.ring(next) == 1
                } else {
                    self.ring(next) >= 2
                }
            })
        })
    }

    #[inline]
    fn base_legal(&self, index: usize) -> bool {
        index < self.cells.len() && self.cells[index] == 0 && self.has_support(index)
    }

    #[inline]
    fn is_legal(&self, index: usize) -> bool {
        self.result.is_none() && self.base_legal(index)
            && (self.stage == 0 || self.first.is_some_and(|first| self.distance(first, index) >= 3))
    }

    pub fn placement_error(&self, index: usize) -> Option<String> {
        if self.result.is_some() { return Some("This match has ended. Start a new match to play again.".into()); }
        if index >= self.cells.len() { return Some("Choose a square on the board.".into()); }
        if self.cells[index] != 0 { return Some("This square already contains a pawn.".into()); }
        if self.stage == 1 && self.first.is_some_and(|first| self.distance(first, index) < 3) {
            return Some("Your second pawn must be at least three squares away from your first, counting diagonally.".into());
        }
        if !self.has_support(index) {
            return Some(if self.is_corner(index) {
                "A corner needs a pawn on its one diagonally touching preborder square."
            } else if self.ring(index) == 0 {
                "A border square must touch a pawn on a preborder square."
            } else {
                "A preborder square must touch a pawn in the interior."
            }.into());
        }
        None
    }

    pub fn legal_moves(&self) -> Vec<usize> {
        let mut moves = Vec::new();
        self.legal_moves_into(&mut moves);
        moves
    }

    pub fn legal_moves_into(&self, moves: &mut Vec<usize>) {
        moves.clear();
        if self.result.is_some() { return; }
        moves.extend((0..self.cells.len()).filter(|&i| self.is_legal(i)));
    }

    pub fn play(&mut self, index: usize) -> Result<Vec<Event>, String> {
        if let Some(reason) = self.placement_error(index) { return Err(reason); }
        Ok(self.commit::<true>(index))
    }

    /// Search uses the same transition code without allocating event payloads.
    pub fn play_fast(&mut self, index: usize) -> Result<(), String> {
        if let Some(reason) = self.placement_error(index) { return Err(reason); }
        self.commit::<false>(index);
        Ok(())
    }

    fn emit<const EVENTS: bool>(events: &mut Vec<Event>, kind: &str, pawn_color: u8, indices: &[usize]) {
        if EVENTS {
            events.push(Event { kind: kind.to_owned(), color: pawn_color, indices: indices.to_vec() });
        }
    }

    fn commit<const EVENTS: bool>(&mut self, index: usize) -> Vec<Event> {
        let mut events = Vec::new();
        let active = self.active;
        self.cells[index] = active | NEW;
        self.placements += 1;
        Self::emit::<EVENTS>(&mut events, "placed", active, &[index]);

        // Collect all rays against one pre-conversion board; converted squares
        // are never new capture origins and cannot cause conversion cascades.
        let mut captured = [0usize; MAX_CELLS];
        let mut count = 0;
        for (dr, dc) in DIRECTIONS {
            let start = count;
            let mut cursor = self.step(index, dr, dc);
            let mut target = 0;
            let mut bracketed = false;
            while let Some(square) = cursor {
                let pawn = self.cells[square];
                let pawn_color = color(pawn);
                if pawn_color == active {
                    bracketed = count > start;
                    break;
                }
                if pawn == 0 || is_new(pawn) { break; }
                if target == 0 { target = pawn_color; }
                if pawn_color != target { break; }
                captured[count] = square;
                count += 1;
                cursor = self.step(square, dr, dc);
            }
            if !bracketed { count = start; }
        }
        for &square in &captured[..count] { self.cells[square] = active; }
        if count > 0 { Self::emit::<EVENTS>(&mut events, "converted", active, &captured[..count]); }

        if let Some((path, orientation)) = self.winning_path(active) {
            Self::emit::<EVENTS>(&mut events, "ended", active, &path);
            self.result = Some(Outcome { winner: Some(active), path, orientation: Some(orientation) });
            return events;
        }

        if !self.opening && self.stage == 0 {
            self.stage = 1;
            self.first = Some(index);
            if (0..self.cells.len()).any(|i| self.is_legal(i)) { return events; }
        }

        self.opening = false;
        self.stage = 0;
        self.first = None;
        self.active = self.active % 4 + 1;
        self.turn += 1;
        Self::emit::<EVENTS>(&mut events, "turn", self.active, &[]);
        let mut aged = [0usize; MAX_CELLS];
        let mut aged_count = 0;
        for (i, pawn) in self.cells.iter_mut().enumerate() {
            if *pawn == self.active | NEW {
                *pawn = self.active;
                aged[aged_count] = i;
                aged_count += 1;
            }
        }
        if aged_count > 0 { Self::emit::<EVENTS>(&mut events, "aged", self.active, &aged[..aged_count]); }
        if !(0..self.cells.len()).any(|i| self.base_legal(i)) {
            self.result = Some(Outcome { winner: None, path: Vec::new(), orientation: None });
            Self::emit::<EVENTS>(&mut events, "ended", 0, &[]);
        }
        events
    }

    /// Returns a shortest touching chain, preferring north/south if both exist.
    /// Every node is non-corner and can be either NEW or OLD.
    pub fn winning_path(&self, pawn_color: u8) -> Option<(Vec<usize>, String)> {
        if !(1..=4).contains(&pawn_color) { return None; }
        for vertical in [true, false] {
            let mut parent = [usize::MAX; MAX_CELLS];
            let mut queue = [0usize; MAX_CELLS];
            let mut head = 0;
            let mut tail = 0;
            for position in 1..self.size - 1 {
                let i = if vertical { position } else { position * self.size };
                if color(self.cells[i]) == pawn_color {
                    parent[i] = i;
                    queue[tail] = i;
                    tail += 1;
                }
            }
            while head < tail {
                let current = queue[head];
                head += 1;
                let reached = if vertical {
                    current / self.size == self.size - 1
                } else {
                    current % self.size == self.size - 1
                };
                if reached {
                    let mut path = vec![current];
                    let mut cursor = current;
                    while parent[cursor] != cursor {
                        cursor = parent[cursor];
                        path.push(cursor);
                    }
                    path.reverse();
                    return Some((path, if vertical { "north-south" } else { "west-east" }.into()));
                }
                for (dr, dc) in DIRECTIONS {
                    if let Some(next) = self.step(current, dr, dc) {
                        if parent[next] == usize::MAX && !self.is_corner(next) && color(self.cells[next]) == pawn_color {
                            parent[next] = current;
                            queue[tail] = next;
                            tail += 1;
                        }
                    }
                }
            }
        }
        None
    }

    /// Stable across browser workers and native builds (no randomized hasher).
    pub fn fingerprint(&self) -> u64 {
        let mut hash = 0xcbf29ce484222325u64;
        let mut add = |value: u64| {
            for byte in value.to_le_bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x100000001b3);
            }
        };
        add(self.size as u64);
        for &cell in &self.cells { add(cell as u64); }
        add(self.active as u64); add(self.stage as u64);
        add(self.first.map_or(u64::MAX, |v| v as u64));
        add(self.opening as u64); add(self.turn as u64); add(self.placements as u64);
        if let Some(result) = &self.result {
            add(1); add(result.winner.unwrap_or(0) as u64);
            for &square in &result.path { add(square as u64); }
        } else { add(0); }
        hash
    }
}
