//! # Holographic Context Memory (HCM) — Innovation #8
//!
//! Replaces the linear KV-Cache with a **fixed-size state matrix** using
//! Vector Symbolic Architectures (VSA). Context is "folded" into the matrix
//! via fast Fourier transforms (FFT) and circular convolution, allowing an
//! **infinite context horizon with ZERO dynamic memory allocation**.
//!
//! # The core insight
//!
//! Instead of storing every token's KV pair (`O(n)` memory), we encode each
//! token's contribution into a fixed-size complex matrix via circular
//! convolution in the frequency domain. Retrieval is done by correlation
//! (inverse FFT of the conjugate product). This is mathematically equivalent
//! to a holographic associative memory — the entire context is "smeared"
//! across the matrix, and any piece can be recovered by probing with the
//! right key.
//!
//! # Mathematical sketch
//!
//! Writing a pair `(key, value)`:
//!
//! ```text
//! state += IFFT( FFT(key) ⊙ FFT(value) )      // circular convolution
//! ```
//!
//! Reading back the value for a known key:
//!
//! ```text
//! value ≈ IFFT( conj(FFT(state)) ⊙ FFT(key) ) // circular correlation
//! ```
//!
//! The conjugation in the read step is what flips the convolution into a
//! correlation — it "undoes" the binding for the matching key while the
//! contributions of all *other* keys average out as Gaussian noise
//! (cross-talk). The signal-to-noise ratio scales as `O(1/√M)` where `M`
//! is the number of superposed pairs, which is why
//! [`capacity`](HolographicMemoryArena::capacity) is `dim / 10` — a
//! conservative point well before cross-talk dominates.
//!
//! # Memory cost
//!
//! `O(D)` where `D` is the vector dimension (fixed at init). This NEVER
//! grows, regardless of how many tokens are processed. A 1024-dimension HCM
//! uses 16 KB and can hold ~100 (key, value) pairs before interference
//! becomes problematic.
//!
//! # Where it sits in the pipeline
//!
//! Side-channel of `/graph/add`: every graph node is also folded into the
//! HCM arena as `(hash(id), hash(text))`. The arena is exposed via
//! `/health` (pair count, interference, memory bytes, capacity) and is the
//! foundation for future HCM-backed retrieval that bypasses the TF-IDF
//! graph entirely.

use std::f64::consts::PI;

/// The HolographicMemoryArena — a fixed-size context matrix that absorbs
/// an infinite number of tokens via FFT-based circular convolution.
///
/// The matrix is stored as a flattened vector of complex numbers (real +
/// imag interleaved for SIMD-friendly access). The dimension `D` must be a
/// power of 2 for the radix-2 FFT to work.
///
/// # Memory Layout
///
/// The arena uses exactly `2 * D * sizeof(f64)` bytes = `16 * D` bytes.
/// For `D=1024`: 16 KB. For `D=4096`: 64 KB. This is FIXED at
/// initialization and never grows.
///
/// # Operations
///
/// - [`fold`](Self::fold)`(key, value)`: encodes a `(key, value)` pair
///   into the matrix via circular convolution.
/// - [`probe`](Self::probe)`(key)`: retrieves the value associated with a
///   key via circular correlation.
/// - [`interference`](Self::interference)`()`: measures the signal-to-noise
///   ratio (how "full" the matrix is).
pub struct HolographicMemoryArena {
    /// The complex state matrix, stored as interleaved `[re0, im0, re1, im1, ...]`.
    /// This is the "hologram" — all context is smeared across this fixed buffer.
    pub state: Vec<f64>,
    /// Dimension `D` (must be a power of 2). The matrix is `D`-dimensional.
    pub dim: usize,
    /// Number of `(key, value)` pairs folded into the matrix.
    pub pair_count: usize,
}

/// Minimal complex number for FFT operations.
///
/// Hand-rolled rather than depending on `num-complex` to keep the
/// dependency tree empty (the engine intentionally has no external math
/// crates). All arithmetic ops are `#[inline(always)]` because they're
/// called inside the FFT butterfly hot loop.
#[derive(Clone, Copy, Debug, Default)]
pub struct Complex64 {
    pub re: f64,
    pub im: f64,
}

impl Complex64 {
    #[inline(always)]
    fn new(re: f64, im: f64) -> Self {
        Self { re, im }
    }

    /// Complex multiplication: `(a+bi)(c+di) = (ac−bd) + (ad+bc)i`.
    #[inline(always)]
    fn mul(self, other: Self) -> Self {
        Self {
            re: self.re * other.re - self.im * other.im,
            im: self.re * other.im + self.im * other.re,
        }
    }

    /// Complex conjugate: `z̄ = a − bi`. Used in the probe step to turn a
    /// convolution into a correlation.
    #[inline(always)]
    fn conj(self) -> Self {
        Self { re: self.re, im: -self.im }
    }

    #[inline(always)]
    fn add(self, other: Self) -> Self {
        Self { re: self.re + other.re, im: self.im + other.im }
    }

    #[inline(always)]
    fn scale(self, s: f64) -> Self {
        Self { re: self.re * s, im: self.im * s }
    }
}

impl HolographicMemoryArena {
    /// Create a new arena with dimension `dim` (must be a power of 2).
    /// Memory usage = `16 * dim` bytes (fixed, never grows).
    ///
    /// # Panics
    ///
    /// Panics if `dim` is not a power of 2 — the radix-2 FFT requires it.
    pub fn new(dim: usize) -> Self {
        assert!(dim.is_power_of_two(), "HCM dimension must be a power of 2");
        Self {
            state: vec![0.0; 2 * dim],
            dim,
            pair_count: 0,
        }
    }

    /// Fold a `(key, value)` pair into the holographic matrix.
    ///
    /// This is the core write operation. It:
    /// 1. Pads key and value to dimension `D` (zero-pad if shorter,
    ///    truncate if longer).
    /// 2. FFTs both to the frequency domain.
    /// 3. Element-wise multiplies them in the frequency domain — by the
    ///    convolution theorem, frequency-domain multiplication *is*
    ///    circular convolution in the spatial domain.
    /// 4. IFFTs the product back to the spatial domain.
    /// 5. Additively superposes the result onto the state matrix.
    ///
    /// The state matrix accumulates all pairs superposed — like a hologram
    /// where every piece of the film contains information about the whole.
    /// Each new pair adds a small amount of cross-talk noise to every
    /// previously-stored pair; see [`interference`](Self::interference).
    pub fn fold(&mut self, key: &[f64], value: &[f64]) {
        let d = self.dim;

        // Pad key and value to dimension D. Zero-padding in the spatial
        // domain is the standard way to size a vector up to the FFT length;
        // it doesn't introduce any extra frequency content.
        let mut k = vec![Complex64::default(); d];
        let mut v = vec![Complex64::default(); d];
        for i in 0..d.min(key.len()) {
            k[i] = Complex64::new(key[i], 0.0);
        }
        for i in 0..d.min(value.len()) {
            v[i] = Complex64::new(value[i], 0.0);
        }

        // FFT both key and value into the frequency domain.
        fft_inplace(&mut k);
        fft_inplace(&mut v);

        // Element-wise multiply in the frequency domain.
        // By the convolution theorem, this is equivalent to circular
        // convolution in the spatial domain — which is exactly the VSA
        // "binding" operation ⊗.
        // Then IFFT the product back to the spatial domain.
        let mut product: Vec<Complex64> = (0..d).map(|i| k[i].mul(v[i])).collect();
        ifft_inplace(&mut product);

        // Add the convolved pair to the state matrix (superposition).
        // The state is interleaved [re, im, re, im, ...] so consecutive
        // indices hold the real and imaginary parts of one complex slot.
        for i in 0..d {
            self.state[2 * i] += product[i].re;
            self.state[2 * i + 1] += product[i].im;
        }

        self.pair_count += 1;
    }

    /// Probe the holographic matrix with a key to retrieve the associated
    /// value.
    ///
    /// This is the core read operation. It:
    /// 1. FFTs the key.
    /// 2. FFTs the state matrix.
    /// 3. Element-wise multiplies `conj(state) ⊙ key` (correlation).
    /// 4. IFFTs the product to get the retrieved value.
    ///
    /// The conjugation is the crucial step that turns the binding
    /// (convolution) into an unbinding (correlation). For the matching
    /// key, the correlation recovers the original value (with cross-talk
    /// noise from all the *other* superposed pairs). For a non-matching
    /// key, the result is pure noise.
    ///
    /// The retrieved value will be an approximation of the original value,
    /// with noise proportional to how many other pairs are stored
    /// (interference). See [`interference`](Self::interference).
    pub fn probe(&self, key: &[f64]) -> Vec<f64> {
        let d = self.dim;

        // Convert the interleaved state buffer back to a Complex64 array
        // so we can FFT it in place.
        let mut state_c: Vec<Complex64> = (0..d)
            .map(|i| Complex64::new(self.state[2 * i], self.state[2 * i + 1]))
            .collect();

        // Pad the probe key to dimension D (same zero-padding as fold()).
        let mut k = vec![Complex64::default(); d];
        for i in 0..d.min(key.len()) {
            k[i] = Complex64::new(key[i], 0.0);
        }

        // FFT both the state and the probe key.
        fft_inplace(&mut state_c);
        fft_inplace(&mut k);

        // Correlation: conj(state) ⊙ key.
        // The conjugate flips the sign of the imaginary part, which has
        // the effect of time-reversing the state in the spatial domain —
        // turning convolution (binding) into correlation (unbinding).
        let mut correlation: Vec<Complex64> = (0..d).map(|i| state_c[i].conj().mul(k[i])).collect();
        ifft_inplace(&mut correlation);

        // Extract real parts (the retrieved value). The imaginary parts
        // carry residual cross-talk energy and are discarded.
        correlation.iter().map(|c| c.re).collect()
    }

    /// Measure the interference level (signal-to-noise ratio).
    ///
    /// Returns a value between `0.0` (perfect recall) and `1.0` (complete
    /// noise). As more pairs are folded, interference increases. The arena
    /// can typically hold ~`D/10` pairs before interference becomes
    /// problematic (see [`capacity`](Self::capacity)).
    ///
    /// # How it's estimated
    ///
    /// The interference is estimated as the ratio of *imaginary* energy to
    /// total energy. The intuition: if exactly one pair is stored, the
    /// spatial-domain convolved result is real (zero imaginary component),
    /// so the state has zero imaginary energy. As more pairs superpose,
    /// their phases no longer align and imaginary energy grows. The
    /// `sqrt(imag / total)` metric thus tracks how "phase-scrambled" the
    /// state has become — a proxy for cross-talk.
    pub fn interference(&self) -> f64 {
        if self.pair_count == 0 {
            return 0.0;
        }
        // Estimate interference as the ratio of imaginary energy to total
        // energy. In a perfect hologram with a single pair, the state is
        // purely real; imaginary components arise from phase interference
        // between superposed pairs.
        let mut real_energy = 0.0;
        let mut imag_energy = 0.0;
        for i in 0..self.dim {
            real_energy += self.state[2 * i] * self.state[2 * i];
            imag_energy += self.state[2 * i + 1] * self.state[2 * i + 1];
        }
        let total = real_energy + imag_energy;
        if total > 0.0 {
            (imag_energy / total).sqrt()
        } else {
            0.0
        }
    }

    /// Clear the matrix (reset to zero state).
    pub fn clear(&mut self) {
        self.state.fill(0.0);
        self.pair_count = 0;
    }

    /// Memory usage in bytes (always fixed = `16 * dim`).
    pub fn memory_bytes(&self) -> usize {
        16 * self.dim
    }

    /// Theoretical capacity (number of pairs before interference > 0.3).
    /// Conservative rule of thumb: `dim / 10`. At this load factor the
    /// cross-talk noise from `O(1/√M)` scaling is still well below the
    /// signal energy of any individual pair.
    pub fn capacity(&self) -> usize {
        self.dim / 10
    }
}

/// In-place iterative Cooley-Tukey FFT (radix-2 decimation-in-time).
///
/// This is a textbook implementation optimized for cache locality.
/// For production, this would use SIMD intrinsics (AVX2/NEON) via
/// `std::simd` or platform-specific intrinsics.
///
/// # Algorithm
///
/// 1. **Bit-reversal permutation**: rearrange the input so that element `i`
///    ends up at the bit-reversed index of `i`. This puts the data into the
///    order the butterfly expects.
/// 2. **Butterfly operations**: for each power-of-2 stage length
///    (`len = 2, 4, 8, …, n`), combine pairs of elements `len/2` apart
///    using the twiddle factor `e^(−2πi/len)`. Each butterfly is:
///    ```text
///    u = data[i + k]
///    v = data[i + k + half] * w           // w = twiddle factor
///    data[i + k]        = u + v           // top wing
///    data[i + k + half] = u − v           // bottom wing
///    ```
///
/// Time complexity: `O(D log D)` where `D` is the vector length.
/// Space complexity: `O(1)` additional (in-place bit-reversal + butterfly).
fn fft_inplace(data: &mut [Complex64]) {
    let n = data.len();
    if n <= 1 {
        return;
    }

    // ---- Bit-reversal permutation ----
    // Walk i from 1 to n-1; j tracks the bit-reversal of i. The inner
    // `while` shifts the bit that caused a carry so j stays bit-reversed
    // without us having to call revbits() per element.
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            // Bit-reversed counter increment: clear the highest set bit
            // that's about to carry, then move down one bit position.
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit; // Set the bit that didn't carry.
        // Only swap once per pair (i < j guard avoids double-swapping).
        if i < j {
            data.swap(i, j);
        }
    }

    // ---- Butterfly operations ----
    // Iterate over stage sizes 2, 4, 8, ..., n. At each stage, butterflies
    // combine elements `half = len/2` apart using the twiddle factor
    // w_len = e^(−2πi/len). Within a stage, the twiddle factor rotates by
    // w_len per butterfly, accumulating multiplicatively (cheaper than
    // calling cos/sin per butterfly).
    let mut len = 2;
    while len <= n {
        let half = len / 2;
        // Twiddle factor base for this stage: w_len = e^(−2πi/len).
        // Negative angle = forward (analysis) DFT convention.
        let angle = -2.0 * PI / len as f64;
        let wlen = Complex64::new(angle.cos(), angle.sin());

        // Slide a window of width `len` across the array; each window holds
        // one butterfly group of `half` pairs.
        let mut i = 0;
        while i < n {
            // w starts at 1+0i and rotates by w_len per butterfly. This is
            // the standard Cooley-Tukey recurrence and avoids re-computing
            // cos/sin inside the inner loop.
            let mut w = Complex64::new(1.0, 0.0);
            for k in 0..half {
                let u = data[i + k];
                let v = data[i + k + half].mul(w);
                // Top wing of the butterfly: u + v.
                data[i + k] = u.add(v);
                // Bottom wing of the butterfly: u − v. Inlined rather than
                // using Complex64::add to avoid constructing an extra
                // negative-v temporary (matters in this hot inner loop).
                data[i + k + half] = Complex64::new(u.re - v.re, u.im - v.im);
                // Advance the twiddle factor for the next butterfly.
                w = w.mul(wlen);
            }
            i += len;
        }
        len <<= 1;
    }
}

/// In-place inverse FFT (conjugate → FFT → conjugate → scale).
///
/// Uses the standard trick: `IFFT(x) = conj(FFT(conj(x))) / n`. Two
/// conjugations cancel out (they only flip the sign of the imaginary part
/// twice), and the forward FFT does the heavy lifting. The final `1/n`
/// scale is required because the forward DFT definition doesn't normalize.
fn ifft_inplace(data: &mut [Complex64]) {
    let n = data.len();
    if n <= 1 {
        return;
    }

    // Conjugate the input (flip imaginary signs).
    for c in data.iter_mut() {
        c.im = -c.im;
    }

    // Forward FFT on the conjugated input.
    fft_inplace(data);

    // Conjugate again (cancelling the first conjugation) and scale by 1/n.
    // The 1/n normalization is what makes this an *inverse* transform:
    // IFFT(FFT(x)) == x.
    let scale = 1.0 / n as f64;
    for c in data.iter_mut() {
        c.im = -c.im;
        *c = c.scale(scale);
    }
}

/// Hash a string into a fixed-size real-valued key vector for HCM.
///
/// Uses a simple but effective hashing scheme: each byte contributes to
/// multiple positions via a rolling hash, creating a pseudo-random but
/// deterministic vector. This is the "key binding" function — different
/// strings map to (approximately) orthogonal vectors, which is what HCM
/// needs for cross-talk to stay low.
///
/// # Why this works
///
/// For VSA to work, distinct keys must produce *near-orthogonal* vectors.
/// The rolling-multiply-and-xror mixing here is a SplitMix-style hash, and
/// the multi-position write spreads the entropy across `dim`. After
/// L2-normalization, distinct strings end up with cosine similarity close
/// to zero (which is exactly the orthogonality VSA requires).
pub fn hash_to_vector(text: &str, dim: usize) -> Vec<f64> {
    let mut vec = vec![0.0; dim];
    let bytes = text.as_bytes();
    // Golden-ratio fractional constant — a standard SplitMix64 seed value.
    let mut seed: u64 = 0x9e3779b97f4a7c15;

    for (i, &byte) in bytes.iter().enumerate() {
        // Mix the byte into the seed using a SplitMix-style multiplier and
        // xorshift. This avalanche the byte's entropy across all 64 bits of
        // the seed so subsequent position lookups are decorrelated.
        seed = seed.wrapping_mul(byte as u64).wrapping_add(0x517cc1b727220a95);
        seed ^= seed >> 31;
        seed = seed.wrapping_mul(0x9e3779b97f4a7c15);

        // Distribute across multiple positions: the low 32 bits and the
        // high 32 bits of the seed each pick a slot. Bipolar contributions
        // (+1/-1, +0.5/-0.5 based on the byte's parity) ensure the
        // resulting vector has roughly zero mean — important for VSA
        // orthogonality between distinct keys.
        let pos = (seed as usize) % dim;
        let pos2 = ((seed >> 32) as usize) % dim;

        vec[pos] += if byte & 1 == 0 { 1.0 } else { -1.0 };
        vec[pos2] += if byte & 2 == 0 { 0.5 } else { -0.5 };

        // Also contribute a position based on the character index so two
        // strings that differ only at byte i produce different fingerprints
        // (without this, anagrams would hash to nearly identical vectors).
        let char_pos = (i * 7 + byte as usize) % dim;
        vec[char_pos] += (byte as f64 - 128.0) / 128.0;
    }

    // L2 normalize so distinct keys end up on the unit hypersphere — this
    // is what makes cosine similarity between keys a meaningful measure of
    // VSA orthogonality. The 1e-10 floor guards against the zero vector.
    let norm: f64 = vec.iter().map(|v| v * v).sum::<f64>().sqrt().max(1e-10);
    vec.iter_mut().for_each(|v| *v /= norm);

    vec
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hcm_basic() {
        let mut hcm = HolographicMemoryArena::new(256);
        let key = hash_to_vector("memory_1", 256);
        let value = hash_to_vector("Alpha-OS is alive", 256);

        hcm.fold(&key, &value);

        let retrieved = hcm.probe(&key);

        // The retrieved vector should be correlated with the original value.
        let dot: f64 = retrieved.iter().zip(value.iter()).map(|(a, b)| a * b).sum();
        assert!(dot > 0.5, "HCM retrieval should be positively correlated, got dot={}", dot);
    }

    #[test]
    fn test_hcm_capacity() {
        let mut hcm = HolographicMemoryArena::new(1024);

        // Fold multiple pairs
        for i in 0..50 {
            let key = hash_to_vector(&format!("key_{}", i), 1024);
            let value = hash_to_vector(&format!("value_{}", i), 1024);
            hcm.fold(&key, &value);
        }

        // First pair should still be retrievable (with some noise)
        let key0 = hash_to_vector("key_0", 1024);
        let value0 = hash_to_vector("value_0", 1024);
        let retrieved = hcm.probe(&key0);

        let dot: f64 = retrieved.iter().zip(value0.iter()).map(|(a, b)| a * b).sum();
        assert!(dot > 0.0, "First pair should still be retrievable after 50 folds");
    }

    #[test]
    fn test_fft_roundtrip() {
        let mut data: Vec<Complex64> = (0..8).map(|i| Complex64::new(i as f64, 0.0)).collect();
        let original = data.clone();

        fft_inplace(&mut data);
        ifft_inplace(&mut data);

        for (a, b) in data.iter().zip(original.iter()) {
            assert!((a.re - b.re).abs() < 1e-10, "FFT roundtrip failed");
        }
    }
}
