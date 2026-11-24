//! Content identity for library files.
//!
//! The canonical key is a BLAKE3 hash of the complete file. It survives a
//! rename, a move and a fresh SAF tree grant, where paths and document URIs do
//! not. A smaller head/tail "quick key" gives rescans a cheap pre-filter; it is
//! never used as the identity because equal-length files with identical front
//! and back matter can collide.

/// Bytes taken from the head and from the tail when building a quick key.
pub const QUICK_SPAN: usize = 64 * 1024;

/// The full, canonical content hash of a file, as lowercase hex.
pub fn content_hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

/// A cheap fingerprint of a file's length plus its head and tail.
///
/// Files shorter than two spans are hashed whole. The length is mixed in so a
/// truncated copy cannot share a key with its original.
pub fn quick_key(bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&(bytes.len() as u64).to_le_bytes());
    if bytes.len() <= QUICK_SPAN * 2 {
        hasher.update(bytes);
    } else {
        hasher.update(&bytes[..QUICK_SPAN]);
        hasher.update(&bytes[bytes.len() - QUICK_SPAN..]);
    }
    hasher.finalize().to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_key_is_stable_and_tracks_the_tail() {
        let mut bytes = vec![7u8; QUICK_SPAN * 3];
        let first = quick_key(&bytes);
        assert_eq!(first, quick_key(&bytes), "the same bytes give the same key");

        let last = bytes.len() - 1;
        bytes[last] = 9;
        assert_ne!(
            first,
            quick_key(&bytes),
            "a change in the tail is visible to the quick key"
        );
    }

    #[test]
    fn quick_key_mixes_in_length() {
        let short = vec![1u8; 32];
        let mut long = short.clone();
        long.push(0);
        assert_ne!(quick_key(&short), quick_key(&long));
    }

    #[test]
    fn identical_bytes_have_the_same_full_hash() {
        assert_eq!(content_hash(b"same"), content_hash(b"same"));
        assert_ne!(content_hash(b"same"), content_hash(b"other"));
    }
}
