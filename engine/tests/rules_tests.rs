use konverson_engine::rules::{alliance, color, is_new, Game, Outcome, NEW, SUPPORTED_SIZES};

fn at(size: usize, row: usize, col: usize) -> usize { row * size + col }
fn fixture(size: usize, active: u8) -> Game {
    let mut game = Game::new(size);
    game.opening = false;
    game.active = active;
    game.turn = active as u32 + 4;
    game
}
fn set(game: &mut Game, row: usize, col: usize, pawn: u8) {
    game.cells[at(game.size, row, col)] = pawn;
    game.placements = game.cells.iter().filter(|&&v| v != 0).count() as u32;
}
fn patterned_full() -> Game {
    let mut game = fixture(9, 1);
    for row in 0..9 { for col in 0..9 {
        set(&mut game, row, col, (2 * (row % 2) + col % 2 + 1) as u8);
    }}
    game
}

#[test]
fn initial_board_only_allows_interior_for_every_supported_size() {
    for size in SUPPORTED_SIZES {
        let game = Game::new(size);
        assert_eq!(game.legal_moves().len(), (size - 4).pow(2));
        for row in 0..size { for col in 0..size {
            let expected = row >= 2 && col >= 2 && row < size - 2 && col < size - 2;
            assert_eq!(game.placement_error(at(size, row, col)).is_none(), expected);
        }}
        game.validate().unwrap();
    }
}

#[test]
fn opening_is_one_a_pawn_then_b_gets_two() {
    let mut game = Game::new(9);
    let events = game.play(at(9, 4, 4)).unwrap();
    assert_eq!(events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["placed", "turn"]);
    assert_eq!((game.active, game.stage, game.turn, game.opening), (2, 0, 2, false));
    game.play(at(9, 3, 3)).unwrap();
    assert_eq!((game.active, game.stage), (2, 1));
    game.play(at(9, 6, 6)).unwrap();
    assert_eq!((game.active, game.stage, game.turn), (3, 0, 3));
}

#[test]
fn colors_rotate_a_b_c_d_and_age_only_on_their_own_return() {
    let mut game = Game::new(9);
    let a_square = at(9, 4, 4);
    game.play(a_square).unwrap();
    for expected in [2, 3, 4] {
        assert_eq!(game.active, expected);
        assert!(is_new(game.cells[a_square]));
        for _ in 0..2 {
            let square = game.legal_moves()[0];
            let events = game.play(square).unwrap();
            if game.active == 1 {
                assert!(events.iter().any(|event| event.kind == "aged" && event.color == 1 && event.indices == [a_square]));
            }
        }
    }
    assert_eq!(game.active, 1);
    assert_eq!(game.cells[a_square], 1);
    assert!(game.cells.iter().any(|&v| v == 2 | NEW));
    assert!(game.cells.iter().any(|&v| v == 3 | NEW));
    assert!(game.cells.iter().any(|&v| v == 4 | NEW));
    assert_eq!((alliance(1), alliance(3), alliance(2), alliance(4)), (0, 0, 1, 1));
}

#[test]
fn distance_is_chebyshev_and_only_constrains_this_turns_pair() {
    let mut game = fixture(9, 1);
    set(&mut game, 4, 3, 2);
    set(&mut game, 2, 2, 4 | NEW);
    game.play(at(9, 4, 4)).unwrap();
    for dr in -2isize..=2 { for dc in -2isize..=2 {
        let row = (4 + dr) as usize;
        let col = (4 + dc) as usize;
        assert!(game.placement_error(at(9, row, col)).is_some());
    }}
    assert_eq!(game.distance(at(9, 4, 4), at(9, 1, 1)), 3);
    assert_eq!(game.distance(at(9, 4, 4), at(9, 2, 5)), 2);
    assert!(game.placement_error(at(9, 1, 1)).is_none());
    game.play(at(9, 1, 1)).unwrap();
}

#[test]
fn preborder_support_requires_interior_but_accepts_diagonal_any_color_or_posture() {
    for pawn in [1, 2, 3, 4, 1 | NEW, 4 | NEW] {
        let mut game = fixture(9, 1);
        set(&mut game, 2, 3, pawn);
        assert!(game.placement_error(at(9, 1, 2)).is_none());
    }
    let mut game = fixture(9, 1);
    set(&mut game, 1, 3, 2);
    set(&mut game, 0, 2, 3);
    assert!(game.placement_error(at(9, 1, 2)).unwrap().contains("interior"));
}

#[test]
fn border_support_requires_preborder() {
    let mut game = fixture(9, 1);
    set(&mut game, 0, 3, 2);
    assert!(game.placement_error(at(9, 0, 4)).unwrap().contains("preborder"));
    set(&mut game, 1, 5, 4 | NEW);
    assert!(game.placement_error(at(9, 0, 4)).is_none());
}

#[test]
fn all_four_corners_require_their_single_diagonal_preborder() {
    for (row, col, support_row, support_col) in [(0, 0, 1, 1), (0, 8, 1, 7), (8, 0, 7, 1), (8, 8, 7, 7)] {
        let mut game = fixture(9, 1);
        set(&mut game, row, support_col, 2);
        set(&mut game, support_row, col, 2);
        let corner = at(9, row, col);
        assert!(game.placement_error(corner).unwrap().contains("diagonally"));
        set(&mut game, support_row, support_col, 3 | NEW);
        assert!(game.placement_error(corner).is_none());
    }
}

#[test]
fn converts_all_eight_rays_together_and_keeps_converted_pawns_old() {
    let mut game = fixture(9, 1);
    let dirs = [(-1isize,-1isize),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)];
    for (dr, dc) in dirs {
        set(&mut game, (4 + dr) as usize, (4 + dc) as usize, 2);
        set(&mut game, (4 + 2 * dr) as usize, (4 + 2 * dc) as usize, 1 | NEW);
    }
    let events = game.play(at(9, 4, 4)).unwrap();
    let converted = events.iter().find(|event| event.kind == "converted").unwrap();
    assert_eq!(converted.indices.len(), 8);
    for &square in &converted.indices { assert_eq!(game.cells[square], 1); }
    assert_eq!(events[0].kind, "placed");
    assert_eq!(events[1].kind, "converted");
}

#[test]
fn captures_single_or_multiple_allied_and_opposing_old_pawns() {
    for target in [2, 3, 4] { for count in [1, 2, 3] {
        let mut game = fixture(9, 1);
        for offset in 1..=count { set(&mut game, 4, 2 + offset, target); }
        set(&mut game, 4, 3 + count, 1);
        game.play(at(9, 4, 2)).unwrap();
        for offset in 1..=count { assert_eq!(game.cells[at(9, 4, 2 + offset)], 1); }
    }}
}

#[test]
fn gaps_new_pawns_and_mixed_colors_block_the_entire_ray() {
    for middle in [0, 2 | NEW, 3, 4 | NEW] {
        let mut game = fixture(9, 1);
        set(&mut game, 4, 3, 2);
        set(&mut game, 4, 4, middle);
        set(&mut game, 4, 5, 1);
        let events = game.play(at(9, 4, 2)).unwrap();
        assert_eq!(game.cells[at(9, 4, 3)], 2);
        assert_eq!(game.cells[at(9, 4, 4)], middle);
        assert!(!events.iter().any(|event| event.kind == "converted"));
    }
}

#[test]
fn first_new_pawn_can_bracket_the_second_pawns_capture() {
    let mut game = fixture(9, 1);
    for col in 3..=5 { set(&mut game, 4, col, 2); }
    game.play(at(9, 4, 2)).unwrap();
    assert_eq!(game.cells[at(9, 4, 3)], 2);
    game.play(at(9, 4, 6)).unwrap();
    for col in 3..=5 { assert_eq!(game.cells[at(9, 4, col)], 1); }
}

#[test]
fn second_placement_can_use_first_placements_conversion_as_an_endpoint() {
    let mut game = fixture(9, 1);
    for col in 3..=5 { set(&mut game, 5, col, 2); }
    set(&mut game, 5, 6, 1);
    set(&mut game, 3, 4, 3);
    set(&mut game, 4, 4, 3);
    game.play(at(9, 5, 2)).unwrap();
    assert_eq!(game.cells[at(9, 5, 4)], 1);
    assert_eq!(game.cells[at(9, 4, 4)], 3);
    game.play(at(9, 2, 4)).unwrap();
    assert_eq!(game.cells[at(9, 3, 4)], 1);
    assert_eq!(game.cells[at(9, 4, 4)], 1);
}

#[test]
fn converted_squares_do_not_initiate_cascades() {
    let mut game = fixture(9, 1);
    set(&mut game, 4, 3, 2);
    set(&mut game, 4, 4, 1);
    set(&mut game, 3, 3, 3);
    set(&mut game, 2, 3, 1);
    game.play(at(9, 4, 2)).unwrap();
    assert_eq!(game.cells[at(9, 4, 3)], 1);
    assert_eq!(game.cells[at(9, 3, 3)], 3);
}

#[test]
fn conversion_is_only_along_straight_orthogonal_or_diagonal_rays() {
    let mut game = fixture(9, 1);
    set(&mut game, 4, 3, 2);
    set(&mut game, 3, 3, 2);
    set(&mut game, 2, 3, 1);
    game.play(at(9, 4, 2)).unwrap();
    assert_eq!(game.cells[at(9, 4, 3)], 2);
    assert_eq!(game.cells[at(9, 3, 3)], 2);
}

#[test]
fn a_corner_can_be_a_capture_endpoint() {
    let mut game = fixture(9, 1);
    set(&mut game, 0, 0, 1);
    set(&mut game, 1, 1, 2);
    game.play(at(9, 2, 2)).unwrap();
    assert_eq!(game.cells[at(9, 1, 1)], 1);
}

#[test]
fn stranding_the_second_placement_is_legal_even_when_another_pair_exists() {
    let mut game = patterned_full();
    for col in [2, 4, 6] { set(&mut game, 4, col, 0); }
    let mut alternative = game.clone();
    alternative.play(at(9, 4, 2)).unwrap();
    assert_eq!(alternative.stage, 1);
    assert!(alternative.legal_moves().contains(&at(9, 4, 6)));
    game.play(at(9, 4, 4)).unwrap();
    assert_eq!((game.active, game.stage, game.first), (2, 0, None));
    assert!(game.result.is_none());
    assert!(!game.legal_moves().is_empty());
}

#[test]
fn one_placement_does_not_draw_when_the_next_color_can_play() {
    let mut game = patterned_full();
    set(&mut game, 4, 4, 0);
    set(&mut game, 4, 5, 0);
    game.play(at(9, 4, 4)).unwrap();
    assert_eq!(game.active, 2);
    assert_eq!(game.stage, 0);
    assert_eq!(game.legal_moves(), [at(9, 4, 5)]);
    assert!(game.result.is_none());
}

#[test]
fn no_legal_first_placement_ends_in_a_draw() {
    let mut game = patterned_full();
    set(&mut game, 4, 4, 0);
    let events = game.play(at(9, 4, 4)).unwrap();
    let result = game.result.as_ref().unwrap();
    assert_eq!(result.winner, None);
    assert!(result.path.is_empty());
    assert_eq!(result.orientation, None);
    assert!(game.legal_moves().is_empty());
    assert_eq!(events.last().unwrap().kind, "ended");
    assert_eq!(events.last().unwrap().color, 0);
}

#[test]
fn first_placement_win_ends_immediately_without_second_or_turn_advance() {
    let mut game = fixture(9, 1);
    for row in 0..9 { if row != 4 { set(&mut game, row, 4, 1); } }
    let events = game.play(at(9, 4, 4)).unwrap();
    assert_eq!(game.result.as_ref().unwrap().winner, Some(1));
    assert_eq!(game.result.as_ref().unwrap().orientation.as_deref(), Some("north-south"));
    assert_eq!(game.result.as_ref().unwrap().path.len(), 9);
    assert!(!events.iter().any(|event| event.kind == "turn"));
    assert_eq!(game.active, 1);
    assert!(game.legal_moves().is_empty());
}

#[test]
fn conversions_can_complete_a_winning_connexion() {
    let mut game = fixture(9, 1);
    for row in 0..9 { set(&mut game, row, 4, if row == 4 { 2 } else { 1 }); }
    set(&mut game, 4, 3, 2);
    set(&mut game, 4, 5, 2);
    set(&mut game, 4, 6, 1);
    assert!(game.winning_path(1).is_none());
    game.validate().unwrap();
    let placed = at(9, 4, 2);
    let events = game.play(placed).unwrap();
    assert_eq!(game.result.as_ref().unwrap().winner, Some(1));
    assert!(!game.result.as_ref().unwrap().path.contains(&placed));
    assert_eq!(game.cells[at(9, 4, 4)], 1);
    assert!(events.iter().position(|event| event.kind == "converted").unwrap()
        < events.iter().position(|event| event.kind == "ended").unwrap());
}

#[test]
fn wins_accept_diagonal_adjacency_new_pawns_and_both_orientations() {
    let mut vertical = fixture(9, 3);
    for row in 0..9 { set(&mut vertical, row, 4 + row % 2, 3 | if row == 3 { NEW } else { 0 }); }
    let (path, orientation) = vertical.winning_path(3).unwrap();
    assert_eq!(orientation, "north-south");
    assert_eq!(path.len(), 9);
    assert!(path.windows(2).all(|pair| vertical.distance(pair[0], pair[1]) == 1));
    let mut horizontal = fixture(9, 4);
    for col in 0..9 { set(&mut horizontal, 4 + col % 2, col, 4); }
    assert_eq!(horizontal.winning_path(4).unwrap().1, "west-east");
}

#[test]
fn allied_colors_do_not_combine_into_one_connexion() {
    let mut game = fixture(9, 1);
    for row in 0..9 { set(&mut game, row, 4, if row % 2 == 0 { 1 } else { 3 }); }
    assert!(game.winning_path(1).is_none());
    assert!(game.winning_path(3).is_none());
}

#[test]
fn corners_cannot_supply_connection_endpoints_or_path_nodes() {
    let mut game = fixture(9, 1);
    set(&mut game, 0, 0, 1);
    for row in 1..9 { set(&mut game, row, 1, 1); }
    assert!(game.winning_path(1).is_none());
    set(&mut game, 0, 1, 1);
    let (path, _) = game.winning_path(1).unwrap();
    assert!(!path.contains(&0));
}

#[test]
fn rejected_moves_leave_the_entire_game_unchanged() {
    let mut game = Game::new(9);
    for index in [0, 1, 81, usize::MAX] {
        let before = game.clone();
        assert!(game.play(index).is_err());
        assert_eq!(game, before);
    }
    game.play(at(9, 4, 4)).unwrap();
    let before = game.clone();
    assert!(game.play(at(9, 4, 4)).is_err());
    assert_eq!(game, before);
    game.play(at(9, 3, 3)).unwrap();
    let before = game.clone();
    assert!(game.play(at(9, 3, 4)).is_err());
    assert_eq!(game, before);
}

#[test]
fn fingerprint_changes_with_rule_relevant_state() {
    let game = Game::new(9);
    assert_eq!(game.fingerprint(), game.clone().fingerprint());
    let mut changed = game.clone();
    changed.play(at(9, 4, 4)).unwrap();
    assert_ne!(game.fingerprint(), changed.fingerprint());
    let mut staged = changed.clone();
    staged.stage = 1;
    assert_ne!(changed.fingerprint(), staged.fingerprint());
    assert_eq!(color(4 | NEW), 4);
}

#[test]
fn state_import_rejects_corrupt_fields_and_consistency_errors() {
    let good = serde_json::to_value(Game::new(9)).unwrap();
    for (field, value) in [
        ("size", serde_json::json!(10)),
        ("active", serde_json::json!(0)),
        ("stage", serde_json::json!(2)),
        ("first", serde_json::json!(40)),
        ("turn", serde_json::json!(0)),
        ("placements", serde_json::json!(2)),
        ("opening", serde_json::json!(false)),
        ("cells", serde_json::json!([0, 0])),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut data = good.clone(); data[field] = value;
        assert!(Game::from_json(&data.to_string()).is_err(), "accepted corrupt {field}");
    }
    let mut invalid_pawn = good;
    invalid_pawn["cells"][40] = serde_json::json!(8);
    assert!(Game::from_json(&invalid_pawn.to_string()).is_err());
}

#[test]
fn state_import_rejects_a_draw_with_an_existing_connexion_for_any_color() {
    let mut valid_draw = patterned_full();
    valid_draw.result = Some(Outcome { winner: None, path: Vec::new(), orientation: None });
    Game::from_json(&serde_json::to_string(&valid_draw).unwrap()).unwrap();
    for winning_color in 1..=4 {
        let mut fabricated = valid_draw.clone();
        fabricated.cells.fill(winning_color);
        let error = Game::from_json(&serde_json::to_string(&fabricated).unwrap()).unwrap_err();
        assert!(error.contains("draw cannot contain a connexion"));
    }
}

#[test]
fn state_import_rejects_a_live_game_with_an_existing_connexion() {
    for winning_color in 1..=4 {
        let mut fabricated = fixture(9, 1);
        for row in 0..9 { set(&mut fabricated, row, 4, winning_color); }
        let error = Game::from_json(&serde_json::to_string(&fabricated).unwrap()).unwrap_err();
        assert!(error.contains("connexion must already be finished"));
    }
}

#[test]
fn all_reachable_random_snapshots_roundtrip_and_fast_play_matches_events_path() {
    let mut seed = 0x92a84ed9u64;
    for size in SUPPORTED_SIZES { for _ in 0..5 {
        let mut game = Game::new(size);
        let mut fast = game.clone();
        while game.result.is_none() {
            game.validate().unwrap();
            let json = serde_json::to_string(&game).unwrap();
            assert_eq!(Game::from_json(&json).unwrap(), game);
            let legal = game.legal_moves();
            seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
            let square = legal[seed as usize % legal.len()];
            game.play(square).unwrap();
            fast.play_fast(square).unwrap();
            assert_eq!(game, fast);
            assert_eq!(game.fingerprint(), fast.fingerprint());
        }
        game.validate().unwrap();
        let json = serde_json::to_string(&game).unwrap();
        assert_eq!(Game::from_json(&json).unwrap(), game);
        if let Some(winner) = game.result.as_ref().unwrap().winner {
            assert!(game.winning_path(winner).is_some());
        }
    }}
}
