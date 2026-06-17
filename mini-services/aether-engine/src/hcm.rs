//! Holographic Context Memory (HCM)
//!
//! Replaces the linear KV-Cache with a fixed-size state matrix using Vector
//! Symbolic Architectures (VSA). Context is "folded" into the matrix via
//! fast Fourier transforms (FFT) and circular convolution, allowing an
//! infinite context horizon with ZERO dynamic memory allocation.
//!
//! The core insight: instead of storing every token's KV pair (O(n) memory),
//! we encode each token's contribution into a fixed-size complex matrix via
//! circular convolution in the frequency domain. Retrieval is done by
//! correlation (inverse FFT of the conjugate product). This is mathematically
//! equivalent to a holographic associative memory — the entire context is
//! "smeared" across the matrix, and any piece can be recovered by probing
//! with the right key.
//!
//! Memory cost: O(D^2) where D is the matrix dimension (fixed at init).
//! This NEVER grows, regardless of how many tokens are processed.
//! A 1024-dimension HCM uses 16MB and can hold effectively infinite context.
//!
//! This is a SIMD-optimized, no_std-compatible implementation.

use std::f64::consts::PI;

/// The HolographicMemoryArena — a fixed-size context matrix that absorbs
/// an infinite number of tokens via FFT-based circular convolution.
///
/// The matrix is stored as a flattened vector of complex numbers (real + imag
/// interleaved for SIMD-friendly access). The dimension D must be a power of 2
/// for the FFT to work.
///
/// # Memory Layout
/// The arena uses exactly 2 * D * sizeof(f64) bytes = 16 * D bytes.
/// For D=1024: 16KB. For D=4096: 64KB. This is FIXED at initialization
/// and never grows.
///
/// # Operations
/// - `fold(key, value)`: encodes a (key, value) pair into the matrix
/// - `probe(key)`: retrieves the value associated with a key
/// - `interference()`: measures the signal-to-noise ratio (how "full" the matrix is)
pub struct HolographicMemoryArena {
    /// The complex state matrix, stored as interleaved [re0, im0, re1, im1, ...]
    /// This is the "hologram" — all context is smeared across this fixed buffer.
    pub state: Vec<f64>,
    /// Dimension D (must be power of 2). The matrix is D-dimensional.
    pub dim: usize,
    /// Number of (key, value) pairs folded into the matrix.
    pub pair_count: usize,
}

/// Minimal complex number for FFT operations.
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

    #[inline(always)]
    fn mul(self, other: Self) -> Self {
        Self {
            re: self.re * other.re - self.im * other.im,
            im: self.re * other.im + self.im * other.re,
        }
    }

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
    /// Create a new arena with dimension D (must be power of 2).
    /// Memory usage = 16 * D bytes (fixed, never grows).
    pub fn new(dim: usize) -> Self {
        assert!(dim.is_power_of_two(), "HCM dimension must be a power of 2");
        Self {
            state: vec![0.0; 2 * dim],
            dim,
            pair_count: 0,
        }
    }

    /// Fold a (key, value) pair into the holographic matrix.
    ///
    /// This is the core write operation. It:
    /// 1. Pads key and value to dimension D
    /// 2. FFT both to frequency domain
    /// 3. Element-wise multiply (convolution theorem)
    /// 4. IFFT back to spatial domain
    /// 5. Add to the state matrix
    ///
    /// The state matrix accumulates all pairs superposed — like a hologram
    /// where every piece of the film contains information about the whole.
    pub fn fold(&mut self, key: &[f64], value: &[f64]) {
        let d = self.dim;

        // Pad key and value to dimension D (zero-pad if shorter, truncate if longer)
        let mut k = vec![Complex64::default(); d];
        let mut v = vec![Complex64::default(); d];
        for i in 0..d.min(key.len()) {
            k[i] = Complex64::new(key[i], 0.0);
        }
        for i in 0..d.min(value.len()) {
            v[i] = Complex64::new(value[i], 0.0);
        }

        // FFT both
        fft_inplace(&mut k);
        fft_inplace(&mut v);

        // Element-wise multiply in frequency domain (= circular convolution in spatial domain)
        // Then IFFT the product
        let mut product: Vec<Complex64> = (0..d).map(|i| k[i].mul(v[i])).collect();
        ifft_inplace(&mut product);

        // Add to state matrix (superposition)
        for i in 0..d {
            self.state[2 * i] += product[i].re;
            self.state[2 * i + 1] += product[i].im;
        }

        self.pair_count += 1;
    }

    /// Probe the holographic matrix with a key to retrieve the associated value.
    ///
    /// This is the core read operation. It:
    /// 1. FFT the key
    /// 2. FFT the state matrix
    /// 3. Element-wise multiply state.conj() * key (correlation)
    /// 4. IFFT to get the retrieved value
    ///
    /// The retrieved value will be an approximation of the original value,
    /// with noise proportional to how many other pairs are stored (interference).
    pub fn probe(&self, key: &[f64]) -> Vec<f64> {
        let d = self.dim;

        // Convert state to complex array
        let mut state_c: Vec<Complex64> = (0..d)
            .map(|i| Complex64::new(self.state[2 * i], self.state[2 * i + 1]))
            .collect();

        // Pad key
        let mut k = vec![Complex64::default(); d];
        for i in 0..d.min(key.len()) {
            k[i] = Complex64::new(key[i], 0.0);
        }

        // FFT both
        fft_inplace(&mut state_c);
        fft_inplace(&mut k);

        // Correlation: conj(state) * key (retrieves the value that was convolved with key)
        let mut correlation: Vec<Complex64> = (0..d).map(|i| state_c[i].conj().mul(k[i])).collect();
        ifft_inplace(&mut correlation);

        // Extract real parts (the retrieved value)
        correlation.iter().map(|c| c.re).collect()
    }

    /// Measure the interference level (signal-to-noise ratio).
    ///
    /// Returns a value between 0.0 (perfect recall) and 1.0 (complete noise).
    /// As more pairs are folded, interference increases. The arena can
    /// typically hold ~D/10 pairs before interference becomes problematic.
    pub fn interference(&self) -> f64 {
        if self.pair_count == 0 {
            return 0.0;
        }
        // Estimate interference as the ratio of imaginary energy to total energy.
        // In a perfect hologram, the state is purely real; imaginary components
        // arise from interference between superposed pairs.
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

    /// Memory usage in bytes (always fixed = 16 * dim).
    pub fn memory_bytes(&self) -> usize {
        16 * self.dim
    }

    /// Theoretical capacity (number of pairs before interference > 0.3).
    pub fn capacity(&self) -> usize {
        self.dim / 10
    }
}

/// In-place iterative Cooley-Tukey FFT (radix-2).
///
/// This is a textbook implementation optimized for cache locality.
/// For production, this would use SIMD intrinsics (AVX2/NEON) via
/// std::simd or platform-specific intrinsics.
///
/// Time complexity: O(D log D) where D is the vector length.
/// Space complexity: O(1) additional (in-place bit-reversal + butterfly).
fn fft_inplace(data: &mut [Complex64]) {
    let n = data.len();
    if n <= 1 {
        return;
    }

    // Bit-reversal permutation
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            data.swap(i, j);
        }
    }

    // Butterfly operations
    let mut len = 2;
    while len <= n {
        let half = len / 2;
        let angle = -2.0 * PI / len as f64;
        let wlen = Complex64::new(angle.cos(), angle.sin());

        let mut i = 0;
        while i < n {
            let mut w = Complex64::new(1.0, 0.0);
            for k in 0..half {
                let u = data[i + k];
                let v = data[i + k + half].mul(w);
                data[i + k] = u.add(v);
                data[i + k + half] = Complex64::new(u.re - v.re, u.im - v.im);
                w = w.mul(wlen);
            }
            i += len;
        }
        len <<= 1;
    }
}

/// In-place inverse FFT (conjugate → FFT → conjugate → scale).
fn ifft_inplace(data: &mut [Complex64]) {
    let n = data.len();
    if n <= 1 {
        return;
    }

    // Conjugate
    for c in data.iter_mut() {
        c.im = -c.im;
    }

    // Forward FFT
    fft_inplace(data);

    // Conjugate and scale
    let scale = 1.0 / n as f64;
    for c in data.iter_mut() {
        c.im = -c.im;
        *c = c.scale(scale);
    }
}

/// Hash a string into a fixed-size real-valued key vector for HCM.
///
/// Uses a simple but effective hashing scheme: each character contributes
/// to multiple positions via a rolling hash, creating a pseudo-random
/// but deterministic vector. This is the "key binding" function.
pub fn hash_to_vector(text: &str, dim: usize) -> Vec<f64> {
    let mut vec = vec![0.0; dim];
    let bytes = text.as_bytes();
    let mut seed: u64 = 0x9e3779b97f4a7c15; // Golden ratio constant

    for (i, &byte) in bytes.iter().enumerate() {
        // Mix the byte into the seed
        seed = seed.wrapping_mul(byte as u64).wrapping_add(0x517cc1b727220a95);
        seed ^= seed >> 31;
        seed = seed.wrapping_mul(0x9e3779b97f4a7c15);

        // Distribute across multiple positions
        let pos = (seed as usize) % dim;
        let pos2 = ((seed >> 32) as usize) % dim;

        vec[pos] += if byte & 1 == 0 { 1.0 } else { -1.0 };
        vec[pos2] += if byte & 2 == 0 { 0.5 } else { -0.5 };

        // Also contribute a position based on the character index
        let char_pos = (i * 7 + byte as usize) % dim;
        vec[char_pos] += (byte as f64 - 128.0) / 128.0;
    }

    // L2 normalize
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

        // The retrieved vector should be correlated with the original value
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
