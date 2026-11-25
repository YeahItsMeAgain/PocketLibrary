//! Release metadata and integrity checks for in-app Android updates.
//!
//! The desktop `tauri-plugin-updater` does not support Android, so PocketLibrary
//! uses a small GitHub Releases manifest of its own. This module is deliberately
//! free of Tauri and network code: it parses/validates the manifest, compares
//! semantic versions, hashes the APK and verifies the minisign signature. The
//! Tauri shell performs the HTTPS transfer and the Android package-installer
//! hand-off.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// The manifest is tiny (notes plus one APK record). Refuse anything that looks
/// like an accidental release asset instead of reading it into memory.
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;

/// A generous ceiling for a signed universal APK. It protects the cache from a
/// malformed or hostile manifest asking the app to fill the disk.
pub const MAX_APK_BYTES: u64 = 512 * 1024 * 1024;

/// The APK record published as `latest.json` on the GitHub release.
///
/// Field names are camelCase because the same shape is consumed by the Rust
/// shell and (later) the React update screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub pub_date: Option<String>,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub signature: String,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum UpdateError {
    #[error("the update manifest is not valid JSON: {0}")]
    InvalidManifest(String),
    #[error("the update manifest is larger than {MAX_MANIFEST_BYTES} bytes")]
    ManifestTooLarge,
    #[error("the update version {0:?} is not valid semantic versioning")]
    InvalidVersion(String),
    #[error("the update URL must be an HTTPS URL")]
    InsecureUrl,
    #[error("the update URL is not a valid URL: {0}")]
    InvalidUrl(String),
    #[error("the update APK size {0} is not plausible")]
    InvalidSize(u64),
    #[error("the update SHA-256 must be 64 hexadecimal characters")]
    InvalidSha256,
    #[error("the update signature is missing or malformed")]
    InvalidSignature,
    #[error("the update signature does not verify against the configured public key")]
    SignatureMismatch,
    #[error("the update signature was made for version {signed}, not {announced}")]
    SignedVersionMismatch { signed: String, announced: String },
    #[error("the downloaded APK is {actual} bytes; the manifest says {expected}")]
    SizeMismatch { expected: u64, actual: u64 },
    #[error("the downloaded APK SHA-256 does not match the manifest")]
    Sha256Mismatch,
    #[error("the update file could not be read: {0}")]
    Io(String),
}

impl UpdateError {
    /// Stable code for the UI/diagnostics layer, matching the shell's error
    /// shape rather than parsing messages.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidManifest(_) | Self::ManifestTooLarge => "manifestInvalid",
            Self::InvalidVersion(_) => "versionInvalid",
            Self::InsecureUrl | Self::InvalidUrl(_) => "urlInvalid",
            Self::InvalidSize(_) => "sizeInvalid",
            Self::InvalidSha256 => "sha256Invalid",
            Self::InvalidSignature => "signatureInvalid",
            Self::SignatureMismatch => "signatureMismatch",
            Self::SignedVersionMismatch { .. } => "signatureVersionMismatch",
            Self::SizeMismatch { .. } => "sizeMismatch",
            Self::Sha256Mismatch => "sha256Mismatch",
            Self::Io(_) => "io",
        }
    }
}

impl From<io::Error> for UpdateError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl ReleaseManifest {
    /// Parse and validate a `latest.json` body.
    pub fn parse(bytes: &[u8]) -> Result<Self, UpdateError> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(UpdateError::ManifestTooLarge);
        }
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|error| UpdateError::InvalidManifest(error.to_string()))?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Validate every field the downloader relies on. Called by [`Self::parse`],
    /// and public so a manifest assembled in Rust can be checked the same way.
    pub fn validate(&self) -> Result<(), UpdateError> {
        parse_version(&self.version)?;

        let url = url::Url::parse(&self.url)
            .map_err(|error| UpdateError::InvalidUrl(error.to_string()))?;
        if url.scheme() != "https" {
            return Err(UpdateError::InsecureUrl);
        }
        if url.host_str().is_none() {
            return Err(UpdateError::InvalidUrl(self.url.clone()));
        }

        if self.size == 0 || self.size > MAX_APK_BYTES {
            return Err(UpdateError::InvalidSize(self.size));
        }
        if !is_sha256_hex(&self.sha256) {
            return Err(UpdateError::InvalidSha256);
        }
        if self.signature.trim().is_empty() {
            return Err(UpdateError::InvalidSignature);
        }
        Ok(())
    }

    /// The manifest version as semver.
    pub fn parsed_version(&self) -> Result<Version, UpdateError> {
        parse_version(&self.version)
    }

    /// True when this release is strictly newer than the running app.
    pub fn is_newer_than(&self, current: &str) -> Result<bool, UpdateError> {
        Ok(self.parsed_version()? > parse_version(current)?)
    }
}

/// Parse a semver string, accepting the optional leading `v` GitHub uses in
/// release tags (`v0.2.0`).
pub fn parse_version(value: &str) -> Result<Version, UpdateError> {
    Version::parse(value.trim().trim_start_matches('v'))
        .map_err(|_| UpdateError::InvalidVersion(value.trim().to_owned()))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Lowercase hex SHA-256 of a byte slice.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    lower_hex(&digest)
}

/// SHA-256 of a file, streamed so a large APK is never held in memory twice.
pub fn sha256_file(path: &Path) -> Result<String, UpdateError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(lower_hex(&hasher.finalize()))
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Verify a Tauri/minisign signature over an in-memory payload.
///
/// `public_key` is the contents of the `.key.pub` file (the one-line base64
/// blob Tauri writes), exactly as pasted into `tauri.conf.json`.
/// `signature` is the contents of the `.sig` file produced by
/// `tauri signer sign`. This is the same encoding the official Tauri updater
/// consumes.
pub fn verify_signature(data: &[u8], signature: &str, public_key: &str) -> Result<(), UpdateError> {
    let public_key = decode_public_key(public_key)?;
    let signature = decode_signature(signature)?;
    public_key
        .verify(data, &signature, true)
        .map_err(|_| UpdateError::SignatureMismatch)
}

/// Verify a downloaded APK against the manifest and the updater public key.
///
/// Three independent checks run while streaming the file once: size, SHA-256,
/// and the minisign signature. The signature's trusted comment must name the
/// same version as the manifest, so a manifest cannot pair a new version with
/// an older signed APK.
pub fn verify_apk(
    path: &Path,
    manifest: &ReleaseManifest,
    public_key: &str,
) -> Result<(), UpdateError> {
    manifest.validate()?;

    let actual = std::fs::metadata(path)?.len();
    if actual != manifest.size {
        return Err(UpdateError::SizeMismatch {
            expected: manifest.size,
            actual,
        });
    }

    let public_key = decode_public_key(public_key)?;
    let signature = decode_signature(&manifest.signature)?;
    let signed_version = signed_version(signature.trusted_comment());
    match signed_version {
        Some(signed) if versions_match(signed, &manifest.version) => {}
        Some(signed) => {
            return Err(UpdateError::SignedVersionMismatch {
                signed: signed.to_owned(),
                announced: manifest.version.clone(),
            });
        }
        None => return Err(UpdateError::InvalidSignature),
    }

    let mut verifier = public_key
        .verify_stream(&signature)
        .map_err(|_| UpdateError::InvalidSignature)?;
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > manifest.size {
            return Err(UpdateError::SizeMismatch {
                expected: manifest.size,
                actual: total,
            });
        }
        hasher.update(&buffer[..read]);
        verifier.update(&buffer[..read]);
    }
    if total != manifest.size {
        return Err(UpdateError::SizeMismatch {
            expected: manifest.size,
            actual: total,
        });
    }
    verifier
        .finalize()
        .map_err(|_| UpdateError::SignatureMismatch)?;

    if lower_hex(&hasher.finalize()) != manifest.sha256.to_ascii_lowercase() {
        return Err(UpdateError::Sha256Mismatch);
    }
    Ok(())
}

fn decode_public_key(value: &str) -> Result<PublicKey, UpdateError> {
    let decoded = BASE64
        .decode(value.trim())
        .map_err(|_| UpdateError::InvalidSignature)?;
    let text = String::from_utf8(decoded).map_err(|_| UpdateError::InvalidSignature)?;
    PublicKey::decode(&text).map_err(|_| UpdateError::InvalidSignature)
}

fn decode_signature(value: &str) -> Result<Signature, UpdateError> {
    let decoded = BASE64
        .decode(value.trim())
        .map_err(|_| UpdateError::InvalidSignature)?;
    let text = String::from_utf8(decoded).map_err(|_| UpdateError::InvalidSignature)?;
    Signature::decode(&text).map_err(|_| UpdateError::InvalidSignature)
}

fn signed_version(trusted_comment: &str) -> Option<&str> {
    trusted_comment
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
}

fn versions_match(signed: &str, announced: &str) -> bool {
    match (parse_version(signed), parse_version(announced)) {
        (Ok(signed), Ok(announced)) => signed == announced,
        _ => signed.trim() == announced.trim(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn manifest() -> ReleaseManifest {
        ReleaseManifest {
            version: "0.2.0".to_owned(),
            notes: "Fixes and a faster shelf.".to_owned(),
            pub_date: Some("2026-11-25T10:00:00Z".to_owned()),
            url: "https://github.com/YeahItsMeAgain/PocketLibrary/releases/download/v0.2.0/PocketLibrary-0.2.0.apk".to_owned(),
            size: 35_359_638,
            sha256: "80ccd6cab3f2f814bc256b49386e15e37a1b88cf13c2980994b9b3dd33ea4de1".to_owned(),
            signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3Q=".to_owned(),
        }
    }

    #[test]
    fn version_comparison_accepts_v_prefix_and_prereleases() {
        assert!(parse_version("v0.2.0").unwrap() > parse_version("0.1.1").unwrap());
        assert!(parse_version("1.0.0").unwrap() > parse_version("1.0.0-rc.1").unwrap());
        assert!(parse_version("0.1.10").unwrap() > parse_version("0.1.9").unwrap());
        assert!(parse_version("not-a-version").is_err());
        assert!(parse_version("").is_err());
    }

    #[test]
    fn manifest_round_trips_and_is_newer() {
        let parsed = ReleaseManifest::parse(&serde_json::to_vec(&manifest()).unwrap()).unwrap();
        assert_eq!(parsed, manifest());
        assert!(parsed.is_newer_than("0.1.1").unwrap());
        assert!(!parsed.is_newer_than("0.2.0").unwrap());
        assert!(!parsed.is_newer_than("0.3.0").unwrap());
    }

    #[test]
    fn manifest_defaults_notes_and_pub_date() {
        let json = br#"{
            "version": "0.2.0",
            "url": "https://example.com/app.apk",
            "size": 1,
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "signature": "sig"
        }"#;
        let parsed = ReleaseManifest::parse(json).unwrap();
        assert_eq!(parsed.notes, "");
        assert_eq!(parsed.pub_date, None);
    }

    #[test]
    fn manifest_rejects_insecure_or_invalid_urls() {
        let mut value = manifest();
        value.url = "http://example.com/app.apk".to_owned();
        assert_eq!(value.validate(), Err(UpdateError::InsecureUrl));

        value.url = "not a url".to_owned();
        assert!(matches!(value.validate(), Err(UpdateError::InvalidUrl(_))));
    }

    #[test]
    fn manifest_rejects_bad_hashes_sizes_and_versions() {
        let mut value = manifest();
        value.sha256 = "abc".to_owned();
        assert_eq!(value.validate(), Err(UpdateError::InvalidSha256));

        value = manifest();
        value.size = 0;
        assert_eq!(value.validate(), Err(UpdateError::InvalidSize(0)));

        value.size = MAX_APK_BYTES + 1;
        assert_eq!(
            value.validate(),
            Err(UpdateError::InvalidSize(MAX_APK_BYTES + 1))
        );

        value = manifest();
        value.version = "0.2".to_owned();
        assert!(matches!(
            value.validate(),
            Err(UpdateError::InvalidVersion(_))
        ));

        value = manifest();
        value.signature = "  ".to_owned();
        assert_eq!(value.validate(), Err(UpdateError::InvalidSignature));
    }

    #[test]
    fn manifest_rejects_oversized_or_non_json_bodies() {
        assert_eq!(
            ReleaseManifest::parse(&vec![b' '; MAX_MANIFEST_BYTES + 1]),
            Err(UpdateError::ManifestTooLarge)
        );
        assert!(matches!(
            ReleaseManifest::parse(b"<html>not json</html>"),
            Err(UpdateError::InvalidManifest(_))
        ));
    }

    #[test]
    fn sha256_matches_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn sha256_file_matches_in_memory_hash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.apk");
        let mut file = File::create(&path).unwrap();
        file.write_all(b"pocketlibrary").unwrap();
        drop(file);
        assert_eq!(sha256_file(&path).unwrap(), sha256_hex(b"pocketlibrary"));
    }

    #[test]
    fn minisign_reference_signature_verifies() {
        // Prehashed minisign signature over the bytes "test", bound to 0.2.0.
        // The public key is a throwaway test key; the private half was never
        // written to the repository.
        let public_key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQwOEI0RDZGRUNGRjhBOEYKUldTUGl2L3NiMDJMME9SMDZCMUVIR2puTkttMk9BY0E3d0YzWkYzQklIS29GZmorbWMxeW56WWoK";
        let signature = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTUGl2L3NiMDJMMEJBd1lQcFpnbG82V1MxYktKNUpIQ0dRR1VQUW43TG00YWdpTDZFalJ4MkMxaFF4RUhBSWRLOU5vcWxZeGdoZ0s4WHBMYW1PVFg0bjdUbS9LYkFJeWcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1NTk0NDE3CWZpbGU6dXBkYXRlci12ZWN0b3IuYmluCXZlcnNpb246MC4yLjAKMXlFdEdGNHpJOGpoWWllajB6aklDYUFyL1NDRnhGaG0vZzZCMURLVTdEYTM0bVhHTER2WUVkL05LUjJvU3pkTHVtZUFqVHBzYnBRUEZ4LzZlSjJURFE9PQo=";
        verify_signature(b"test", signature, public_key).unwrap();
        assert!(verify_signature(b"tampered", signature, public_key).is_err());
        assert!(verify_signature(b"test", "not base64", public_key).is_err());
    }

    #[test]
    fn verify_apk_streams_hash_and_version_bound_signature() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.apk");
        std::fs::write(&path, b"test").unwrap();

        let public_key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQwOEI0RDZGRUNGRjhBOEYKUldTUGl2L3NiMDJMME9SMDZCMUVIR2puTkttMk9BY0E3d0YzWkYzQklIS29GZmorbWMxeW56WWoK";
        let signature = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTUGl2L3NiMDJMMEJBd1lQcFpnbG82V1MxYktKNUpIQ0dRR1VQUW43TG00YWdpTDZFalJ4MkMxaFF4RUhBSWRLOU5vcWxZeGdoZ0s4WHBMYW1PVFg0bjdUbS9LYkFJeWcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1NTk0NDE3CWZpbGU6dXBkYXRlci12ZWN0b3IuYmluCXZlcnNpb246MC4yLjAKMXlFdEdGNHpJOGpoWWllajB6aklDYUFyL1NDRnhGaG0vZzZCMURLVTdEYTM0bVhHTER2WUVkL05LUjJvU3pkTHVtZUFqVHBzYnBRUEZ4LzZlSjJURFE9PQo=";

        let mut value = manifest();
        value.size = 4;
        value.sha256 = sha256_hex(b"test");
        value.signature = signature.to_owned();
        verify_apk(&path, &value, public_key).unwrap();

        value.version = "0.3.0".to_owned();
        assert!(matches!(
            verify_apk(&path, &value, public_key),
            Err(UpdateError::SignedVersionMismatch { .. })
        ));

        value.version = "0.2.0".to_owned();
        std::fs::write(&path, b"tampered").unwrap();
        assert!(matches!(
            verify_apk(&path, &value, public_key),
            Err(UpdateError::SizeMismatch { .. })
        ));
    }

    #[test]
    fn verify_apk_rejects_wrong_size_before_signature_work() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.apk");
        std::fs::write(&path, b"short").unwrap();
        let mut value = manifest();
        value.size = 1;
        value.signature = BASE64.encode("not a signature");
        assert_eq!(
            verify_apk(&path, &value, "not a key"),
            Err(UpdateError::SizeMismatch {
                expected: 1,
                actual: 5
            })
        );
    }
}
