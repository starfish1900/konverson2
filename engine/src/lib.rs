pub mod rules;
pub mod search;

use rules::{Game, SUPPORTED_SIZES};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn js_error(reason: String) -> JsValue { JsValue::from_str(&reason) }

#[wasm_bindgen]
pub fn new_game(size: usize) -> Result<String, JsValue> {
    if !SUPPORTED_SIZES.contains(&size) {
        return Err(JsValue::from_str("Board size must be 9, 11, 13, or 15."));
    }
    serde_json::to_string(&Game::new(size)).map_err(|e| js_error(e.to_string()))
}

#[wasm_bindgen]
pub fn legal_moves(state_json: &str) -> Result<String, JsValue> {
    let state = Game::from_json(state_json).map_err(js_error)?;
    serde_json::to_string(&state.legal_moves()).map_err(|e| js_error(e.to_string()))
}

#[wasm_bindgen]
pub fn explain_move(state_json: &str, index: usize) -> Result<String, JsValue> {
    let state = Game::from_json(state_json).map_err(js_error)?;
    Ok(state.placement_error(index).unwrap_or_default())
}

#[derive(Serialize)]
struct AppliedMove { state: Game, events: Vec<rules::Event> }

#[wasm_bindgen]
pub fn apply_move(state_json: &str, index: usize) -> Result<String, JsValue> {
    let mut state = Game::from_json(state_json).map_err(js_error)?;
    let events = state.play(index).map_err(js_error)?;
    serde_json::to_string(&AppliedMove { state, events }).map_err(|e| js_error(e.to_string()))
}
