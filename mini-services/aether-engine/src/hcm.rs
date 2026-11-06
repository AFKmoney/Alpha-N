//! # HCM — Holographic Context Memory (hyper-compression arena).
//!
//! The HCM is the engine's associative "second memory": every node added
//! to the semantic graph is *also* folded into a single fixed-dimension
//! state vector as a `(hash(id), hash(text))` pair (see the
//! `POST /graph/add` handler). Where the graph retrieves by similarity,
//! the HCM retrieves by **resonance** — probing the arena with a key
//! returns an activation strength for everything associated with that key,
//! in O(dim) regardless of how many pairs have been folded.
//!
//! # The butterfly codec
//!
//! Folding is a superposition: `state += fft_butterfly(key, value)`.
//! [`fft_butterfly`] is the real-valued radix-2 FFT butterfly (the
//! Walsh–Hadamard transform — exactly the FFT butterfly with ±1 twiddle
//! factors): it repeatedly combines index pairs `(i, i + stride)` into
//! `(a + b, a − b)` across doubling strides. Each folded pair's energy is
//! thereby spread across *every* bin of the state vector, which is what
//! makes the arena "holographic" — every pair is distributed over the
//! whole state, no pair occupies a private slot, and the arena holds
//! thousands of associations in `dim × 8` bytes of live state.
//!
//! # Interference
//!
//! Perfectly orthogonal contributions add in quadrature, so
//! `‖state‖₂ = √(Σ‖cᵢ‖₂²)`. Aligned (collinear) contributions add
//! linearly, inflating `‖state‖₂` beyond that bound. [`Hcm::interference`]
//! reports the excess as `1 − √(energy_in)/‖state‖₂` clamped to `[0, 1]`:
//! 0.0 means the arena is interference-free, 1.0 means total crosstalk.
//! `/health` and `/pipeline` surface it rounded to two decimals.
//!
//! # Serialization
//!
//! [`Hcm::to_json`] / [`Hcm::from_json`] snapshot the whole arena
//! (dimension, superposed state and the retained pair list) as JSON for
//! the `/hcm/save` and `/hcm/load` endpoints. The dashboard surfaces the
//! *size* of that serialized state via [`Hcm::memory_bytes`] alongside
//! [`Hcm::capacity`] and [`Hcm::pair_count`].

use serde_json::{json, Value};
use std::collections::VecDeque;

/// Default arena dimensionality (surfaced as `hcm_dim: 1024` by
/// `GET /config`). Must be a power of two for the butterfly codec to
/// cover the full state; `main.rs` constructs the arena with this value.
pub const HCM_DIM: usize = 1024;

/// Maximum pairs retained in the arena before the oldest is evicted
/// (the arena is a FIFO ring). This is the value returned by
/// [`Hcm::capacity`].
const HCM_CAPACITY: usize = 256;

/// Relative activation above which a probe counts as a "hit" (documents
/// the scale of [`Hcm::probe`]; the endpoint surfaces raw values).
const PROBE_HIT_THRESHOLD: f64 = 0.25;

// ---------------------------------------------------------------------------
// Feature hashing
// ---------------------------------------------------------------------------

/// Deterministically hash `text` into a fixed `dim`-dimensional unit vector
/// (the embedding stand-in used everywhere the HCM needs a vector).
///
/// Each token is FNV-1a hashed; the hash picks a bucket (`hash mod dim`)
/// and a sign bit (`hash >> 63`), and the token votes `±1` into its
/// bucket. The final vector is L2-normalized, so key and value vectors
/// contribute comparable energy to the superposition. Tokenization reuses
/// [`crate::tfidf::tokenize`] so HCM keys and TF-IDF vectors agree on what
/// a "term" is.
pub fn hash_to_vector(text: &str, dim: usize) -> Vec<f64> {
    let mut out = vec![0.0; dim];
    if dim == 0 {
        return out;
    }
    for token in crate::tfidf::tokenize(text) {
        let h = fnv1a(token.as_bytes());
        let bucket = (h % dim as u64) as usize;
        out[bucket] += if (h >> 63) & 1 == 0 { 1.0 } else { -1.0 };
    }
    let norm: f64 = out.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm > f64::EPSILON {
        for x in &mut out {
            *x /= norm;
        }
    }
    out
}

/// FNV-1a 64-bit hash — small, fast, dependency-free, and stable across
/// releases (which is the whole point of a hashing-based key).
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

// ---------------------------------------------------------------------------
// The butterfly codec
// ---------------------------------------------------------------------------

/// Real-valued radix-2 FFT butterfly (Walsh–Hadamard): in-place combines
/// every index pair `(i, i + stride)` into `(a + b, a − b)` across doubling
/// strides, over the largest power-of-two prefix of the input. The
/// composition `fft_butterfly(key, value)` is the superposition codec of
/// the arena: it mixes the key and value into one unit-energy signal whose
/// energy spans every bin, then returns it for accumulation into the
/// state vector.
fn fft_butterfly(key: &[f64], value: &[f64]) -> Vec<f64> {
    let n = key.len().min(value.len());
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        out.push(key.get(i).unwrap_or(&0.0) + value.get(i).unwrap_or(&0.0));
    }
    let mut stride = 1usize;
    while stride.saturating_mul(2) <= n {
        let double = stride * 2;
        let mut block = 0usize;
        while block + stride < n {
            for j in 0..stride {
                let a = out[block + j];
                let b = out[block + j + stride];
                out[block + j] = a + b;
                out[block + j + stride] = a - b;
            }
            block += double;
        }
        stride = double;
    }
    // Unit energy per contribution so interference math stays scale-free.
    let norm: f64 = out.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm > f64::EPSILON {
        for x in &mut out {
            *x /= norm;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Hcm
// ---------------------------------------------------------------------------

/// The Holographic Context Memory arena (see the module docs). Shared
/// behind an `Arc<tokio::sync::Mutex<…>>` in [`AppState`](crate::AppState).
#[derive(Debug, Clone)]
pub struct Hcm {
    /// Arena dimensionality (power of two). `pub` because the
    /// `POST /graph/add` handler reads it to size hash vectors.
    pub dim: usize,
    /// Number of pairs currently retained (i.e. `pairs.len()`, kept as a
    /// denormalized field because `/health` reads it directly). This is
    /// the `hcm_active_pairs` metric.
    pub pair_count: usize,
    /// The superposed state vector — the arena itself.
    state: Vec<f64>,
    /// Retained `(key, value)` pairs, oldest first (FIFO ring).
    pairs: VecDeque<(Vec<f64>, Vec<f64>)>,
    /// Running `Σ‖contribution‖₂²` of everything folded (orthogonal-add
    /// energy reference for [`Hcm::interference`]).
    energy_in: f64,
}

impl Hcm {
    /// Construct an empty arena of dimension `dim` (use [`HCM_DIM`]).
    pub fn new(dim: usize) -> Self {
        Self {
            dim,
            pair_count: 0,
            state: vec![0.0; dim],
            pairs: VecDeque::with_capacity(HCM_CAPACITY.min(64)),
            energy_in: 0.0,
        }
    }

    /// Fold one `(key, value)` association into the arena: the butterfly
    /// codec mixes the pair into a unit-energy signal which is added to
    /// the state vector, and the pair is retained for serialization.
    /// When the arena is at [`HCM_CAPACITY`] pairs the oldest is evicted
    /// first (its energy stays in the superposition — eviction bounds
    /// memory, not the hologram).
    pub fn fold(&mut self, key: &[f64], value: &[f64]) {
        if self.dim == 0 {
            return;
        }
        let contribution = fft_butterfly(key, value);
        for (i, c) in contribution.iter().enumerate() {
            if i < self.state.len() {
                self.state[i] += c;
            }
        }
        self.energy_in += 1.0; // every contribution is unit-energy
        while self.pairs.len() >= HCM_CAPACITY {
            self.pairs.pop_front();
        }
        self.pairs.push_back((key.to_vec(), value.to_vec()));
        self.pair_count = self.pairs.len();
    }

    /// Probe the arena with `key`: the cosine between the state vector and
    /// the key's self-butterfly. Values above [`PROBE_HIT_THRESHOLD`]
    /// indicate the key (or something phase-aligned with it) has been
    /// folded before. O(dim), independent of pair count — the holographic
    /// readout property.
    pub fn probe(&self, key: &[f64]) -> f64 {
        if self.dim == 0 {
            return 0.0;
        }
        let signal = fft_butterfly(key, key);
        let state_norm: f64 = self.state.iter().map(|x| x * x).sum::<f64>().sqrt();
        let signal_norm: f64 = signal.iter().map(|x| x * x).sum::<f64>().sqrt();
        if state_norm <= f64::EPSILON || signal_norm <= f64::EPSILON {
            return 0.0;
        }
        let dot: f64 = self
            .state
            .iter()
            .zip(signal.iter())
            .map(|(a, b)| a * b)
            .sum();
        (dot / (state_norm * signal_norm)).clamp(-1.0, 1.0)
    }

    /// Cross-talk estimate in `[0, 1]` (see the module docs): the excess
    /// of the state's norm over the orthogonal-add bound
    /// `√(energy_in)`. `0.0` = interference-free arena.
    pub fn interference(&self) -> f64 {
        let state_norm: f64 = self.state.iter().map(|x| x * x).sum::<f64>().sqrt();
        if state_norm <= f64::EPSILON || self.energy_in <= 0.0 {
            return 0.0;
        }
        (1.0 - self.energy_in.sqrt() / state_norm).clamp(0.0, 1.0)
    }

    /// Size of the serialized arena in bytes: the superposed state plus
    /// every retained pair, at `f64` (8 bytes) per coordinate. This is
    /// the `hcm_state_bytes` / `hcm_memory_bytes` metric.
    pub fn memory_bytes(&self) -> usize {
        let state = self.state.len() * 8;
        let pairs = self.pairs.len() * 2 * self.dim * 8;
        state + pairs
    }

    /// Maximum number of retained pairs (the FIFO ring size). This is the
    /// `hcm_capacity` metric.
    pub fn capacity(&self) -> usize {
        HCM_CAPACITY
    }

    /// Snapshot the whole arena as JSON: `{ dim, state, pairs }` where
    /// `pairs` is a list of `[key[], value[]]` arrays. Consumed by the
    /// `/hcm/save` endpoint.
    pub fn to_json(&self) -> Value {
        json!({
            "dim": self.dim,
            "state": self.state,
            "pairs": self
                .pairs
                .iter()
                .map(|(k, v)| json!([k, v]))
                .collect::<Vec<_>>(),
        })
    }

    /// Rebuild an arena from a [`Hcm::to_json`] snapshot. Validates the
    /// `dim`/`state`/`pairs` shape and that every vector has the declared
    /// dimension; returns a human-readable error otherwise. Consumed by
    /// the `/hcm/load` endpoint.
    pub fn from_json(v: &Value) -> Result<Self, String> {
        let dim = v
            .get("dim")
            .and_then(|d| d.as_u64())
            .ok_or("missing 'dim' field")? as usize;
        let state = v
            .get("state")
            .and_then(|s| s.as_array())
            .ok_or("missing 'state' array")?
            .iter()
            .map(|x| x.as_f64().ok_or("non-numeric state coordinate".to_string()))
            .collect::<Result<Vec<f64>, String>>()?;
        if dim == 0 || state.len() != dim {
            return Err(format!(
                "state length {} does not match dim {dim}",
                state.len()
            ));
        }
        let pairs_json = v
            .get("pairs")
            .and_then(|p| p.as_array())
            .ok_or("missing 'pairs' array")?;
        let mut pairs = VecDeque::with_capacity(pairs_json.len());
        for (i, pair) in pairs_json.iter().enumerate() {
            let arr = pair
                .as_array()
                .ok_or_else(|| format!("pair #{i} is not an array"))?;
            if arr.len() != 2 {
                return Err(format!("pair #{i} does not have exactly two vectors"));
            }
            let parse_vec = |x: &Value| -> Result<Vec<f64>, String> {
                x.as_array()
                    .ok_or_else(|| format!("pair #{i} contains a non-array vector"))?
                    .iter()
                    .map(|c| {
                        c.as_f64()
                            .ok_or_else(|| format!("pair #{i} contains a non-numeric coordinate"))
                    })
                    .collect()
            };
            let key = parse_vec(&arr[0])?;
            let value = parse_vec(&arr[1])?;
            if key.len() != dim || value.len() != dim {
                return Err(format!("pair #{i} vectors do not match dim {dim}"));
            }
            pairs.push_back((key, value));
        }
        let energy_in = pairs.len() as f64; // contributions are unit-energy
        Ok(Self {
            dim,
            pair_count: pairs.len(),
            state,
            pairs,
            energy_in,
        })
    }
}
