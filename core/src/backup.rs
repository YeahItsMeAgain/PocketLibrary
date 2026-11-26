//! The versioned `.pocketlibrary` backup archive.
//!
//! An archive is a zip with one `manifest.json` and, optionally, cached covers
//! under `covers/`. The books themselves are never included: they live in the
//! user's library folder and are re-linked by content hash on restore.
//!
//! The manifest is deliberately a portable document, not a database dump. Books
//! are referenced by content hash rather than internal id, shelves by ordinal,
//! and labels by name, so an archive restores cleanly into a fresh catalogue.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::cover;
use crate::error::{Error, Result};
use crate::models::{BookFormat, CoverSource, DownloadState, ReadingStatus};

/// Marker stored in `manifest.json` so another zip cannot be mistaken for one.
pub const BACKUP_KIND: &str = "pocketlibrary-backup";
/// The archive format this build writes and reads.
pub const BACKUP_FORMAT_VERSION: i64 = 1;
/// File extension the UI should suggest in the system picker.
pub const BACKUP_EXTENSION: &str = "pocketlibrary";

const MANIFEST_NAME: &str = "manifest.json";
const COVERS_DIR: &str = "covers";
const DEFAULT_SHELF_CAPACITY: i64 = 12;

/// Two device-local SAF tokens that must never travel between devices.
const DEVICE_LOCAL_SETTINGS: &[&str] = &["library_folder_uri", "library_folder_name"];

/// How an imported archive treats the current catalogue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    /// Keep existing data, add missing books, and never delete anything.
    Merge,
    /// Clear catalogue metadata and restore the archive exactly.
    Replace,
}

/// What an import would do, computed before anything is applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    /// Archive books whose content hash is already in this library.
    pub matched: usize,
    /// Archive books this library does not have yet.
    pub new: usize,
}

/// What an import changed.
///
/// Merge: `matched` books already existed, `new` were added, `skipped` reading
/// positions were kept because the local one was newer, and `replaced` is zero.
/// Replace: `matched`/`new` describe the archive against the pre-wipe catalogue,
/// `replaced` is the number of existing catalogue books that were cleared, and
/// `skipped` is zero.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub mode: ImportMode,
    pub matched: usize,
    pub new: usize,
    pub skipped: usize,
    pub replaced: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    kind: String,
    schema_version: i64,
    exported_at: i64,
    shelves: Vec<ManifestShelf>,
    books: Vec<ManifestBook>,
    labels: Vec<ManifestLabel>,
    book_labels: Vec<ManifestBookLabel>,
    reading_states: Vec<ManifestReadingState>,
    annotations: Vec<ManifestAnnotation>,
    settings: Vec<ManifestSetting>,
    downloads: Vec<ManifestDownload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestShelf {
    ordinal: i64,
    capacity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestBook {
    content_hash: String,
    format: BookFormat,
    title: String,
    authors: Vec<String>,
    series: Option<String>,
    language: Option<String>,
    description: Option<String>,
    publisher: Option<String>,
    published_date: Option<String>,
    identifier: Option<String>,
    page_count: Option<i64>,
    /// Zip entry name under `covers/`, absent when no cover was cached.
    cover_file: Option<String>,
    cover_source: Option<CoverSource>,
    /// The file's own cover, when it differs from the active (manual/online) one.
    #[serde(default)]
    file_cover_file: Option<String>,
    #[serde(default)]
    file_cover_source: Option<CoverSource>,
    /// Manual and online provenance rows. File-derived fields have no row.
    #[serde(default)]
    provenance: Vec<ManifestProvenance>,
    added_at: i64,
    shelf_ordinal: Option<i64>,
    slot_index: Option<i64>,
    #[serde(skip)]
    cover_path: Option<String>,
    #[serde(skip)]
    file_cover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestProvenance {
    field: String,
    source: String,
    source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestLabel {
    name: String,
    colour: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestBookLabel {
    book: String,
    label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestReadingState {
    book: String,
    status: ReadingStatus,
    status_source: String,
    progress: f64,
    locator: Option<String>,
    last_opened_at: Option<i64>,
    finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestAnnotation {
    book: String,
    kind: String,
    colour: Option<String>,
    note: Option<String>,
    locator: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestSetting {
    key: String,
    value: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestDownload {
    md5: String,
    title: String,
    authors: Vec<String>,
    year: Option<i64>,
    format: BookFormat,
    source: String,
    mirror_urls: Vec<String>,
    state: DownloadState,
    bytes: i64,
    total_bytes: Option<i64>,
    error: Option<String>,
    error_code: Option<String>,
    book: Option<String>,
    filename: Option<String>,
    created_at: i64,
    updated_at: i64,
    finished_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupHeader {
    kind: String,
    schema_version: i64,
}

/// Serialise the catalogue into a zip archive. Readable covers are included;
/// unreadable or absent covers are silently skipped.
pub fn export(conn: &Connection, _cover_dir: &Path) -> Result<Vec<u8>> {
    let mut manifest = build_manifest(conn)?;
    let mut covers = HashMap::new();
    for book in &mut manifest.books {
        if let Some(path) = &book.cover_path
            && let Ok(bytes) = fs::read(path)
            && !bytes.is_empty()
        {
            let entry = format!("{COVERS_DIR}/{}.jpg", book.content_hash);
            book.cover_file = Some(entry.clone());
            covers.insert(entry, bytes);
        } else {
            book.cover_file = None;
        }
        let file_path = book.file_cover_path.clone();
        if let Some(path) = file_path
            && book.cover_file.is_some()
            && let Ok(bytes) = fs::read(&path)
            && !bytes.is_empty()
            && !covers
                .get(&format!("{COVERS_DIR}/{}.jpg", book.content_hash))
                .is_some_and(|existing| existing == &bytes)
        {
            let entry = format!("{COVERS_DIR}/{}-file.jpg", book.content_hash);
            book.file_cover_file = Some(entry.clone());
            covers.insert(entry, bytes);
        } else {
            book.file_cover_file = None;
        }
    }

    let json = serde_json::to_vec(&manifest).map_err(json_error)?;
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut buffer);
        zip.start_file(
            MANIFEST_NAME,
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .map_err(zip_error)?;
        zip.write_all(&json).map_err(Error::from)?;

        for (name, bytes) in covers {
            zip.start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .map_err(zip_error)?;
            zip.write_all(&bytes).map_err(Error::from)?;
        }
        zip.finish().map_err(zip_error)?;
    }
    Ok(buffer.into_inner())
}

/// Count matched and new books without applying anything.
pub fn preview(conn: &Connection, bytes: &[u8]) -> Result<BackupPreview> {
    let (manifest, _covers) = read_archive(bytes)?;
    let mut matched = 0;
    let mut new = 0;
    for book in &manifest.books {
        if find_book(conn, &book.content_hash)?.is_some() {
            matched += 1;
        } else {
            new += 1;
        }
    }
    Ok(BackupPreview { matched, new })
}

/// Apply an archive inside the caller's transaction.
pub fn import(
    tx: &Transaction<'_>,
    cover_dir: &Path,
    bytes: &[u8],
    mode: ImportMode,
) -> Result<BackupReport> {
    let (manifest, covers) = read_archive(bytes)?;
    validate(&manifest)?;
    match mode {
        ImportMode::Merge => merge(tx, cover_dir, &manifest, &covers),
        ImportMode::Replace => replace(tx, cover_dir, &manifest, &covers),
    }
}

fn build_manifest(conn: &Connection) -> Result<BackupManifest> {
    let mut shelves = Vec::new();
    {
        let mut statement =
            conn.prepare("SELECT ordinal, capacity FROM shelves ORDER BY ordinal")?;
        let rows = statement.query_map([], |row| {
            Ok(ManifestShelf {
                ordinal: row.get(0)?,
                capacity: row.get(1)?,
            })
        })?;
        for row in rows {
            shelves.push(row?);
        }
    }

    let mut labels = Vec::new();
    {
        let mut statement =
            conn.prepare("SELECT name, colour, created_at FROM labels ORDER BY created_at, id")?;
        let rows = statement.query_map([], |row| {
            Ok(ManifestLabel {
                name: row.get(0)?,
                colour: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        for row in rows {
            labels.push(row?);
        }
    }

    let mut books = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT b.content_hash, b.format, b.title, b.authors, b.series,
                    b.language, b.description, b.publisher, b.published_date, b.identifier,
                    b.page_count, b.cover_path, b.cover_source, b.added_at, s.ordinal,
                    b.slot_index, b.file_cover_path, b.file_cover_source
             FROM books b LEFT JOIN shelves s ON s.id = b.shelf_id
             ORDER BY b.shelf_id IS NULL, b.shelf_id, b.slot_index, b.id",
        )?;
        let rows = statement.query_map([], |row| {
            let authors_json: String = row.get(3)?;
            let content_hash: String = row.get(0)?;
            let cover_path: Option<String> = row.get(11)?;
            let file_cover_path: Option<String> = row.get(16)?;
            let cover_file = cover_path
                .as_ref()
                .map(|_| format!("{COVERS_DIR}/{content_hash}.jpg"));
            let file_cover_file = file_cover_path
                .as_ref()
                .map(|_| format!("{COVERS_DIR}/{content_hash}-file.jpg"));
            Ok(ManifestBook {
                cover_file,
                content_hash,
                format: row.get(1)?,
                title: row.get(2)?,
                authors: serde_json::from_str(&authors_json).unwrap_or_default(),
                series: row.get(4)?,
                language: row.get(5)?,
                description: row.get(6)?,
                publisher: row.get(7)?,
                published_date: row.get(8)?,
                identifier: row.get(9)?,
                page_count: row.get(10)?,
                cover_source: row.get(12)?,
                file_cover_file,
                file_cover_source: row.get(17)?,
                provenance: Vec::new(),
                added_at: row.get(13)?,
                shelf_ordinal: row.get(14)?,
                slot_index: row.get(15)?,
                cover_path,
                file_cover_path,
            })
        })?;
        for row in rows {
            books.push(row?);
        }
    }

    let mut provenance_by_hash: HashMap<String, Vec<ManifestProvenance>> = HashMap::new();
    {
        let mut statement = conn.prepare(
            "SELECT b.content_hash, p.field, p.source, p.source_url
             FROM field_provenance p JOIN books b ON b.id = p.book_id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                ManifestProvenance {
                    field: row.get(1)?,
                    source: row.get(2)?,
                    source_url: row.get(3)?,
                },
            ))
        })?;
        for row in rows {
            let (hash, entry) = row?;
            provenance_by_hash.entry(hash).or_default().push(entry);
        }
    }
    for book in &mut books {
        book.provenance = provenance_by_hash
            .remove(&book.content_hash)
            .unwrap_or_default();
    }

    let mut reading_states = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT b.content_hash, r.status, r.status_source, r.progress, r.locator,
                    r.last_opened_at, r.finished_at
             FROM reading_state r JOIN books b ON b.id = r.book_id
             ORDER BY b.id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ManifestReadingState {
                book: row.get(0)?,
                status: row.get(1)?,
                status_source: row.get(2)?,
                progress: row.get(3)?,
                locator: row.get(4)?,
                last_opened_at: row.get(5)?,
                finished_at: row.get(6)?,
            })
        })?;
        for row in rows {
            reading_states.push(row?);
        }
    }

    let mut annotations = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT b.content_hash, a.kind, a.colour, a.note, a.locator, a.created_at, a.updated_at
             FROM annotations a JOIN books b ON b.id = a.book_id
             ORDER BY a.id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ManifestAnnotation {
                book: row.get(0)?,
                kind: row.get(1)?,
                colour: row.get(2)?,
                note: row.get(3)?,
                locator: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        for row in rows {
            annotations.push(row?);
        }
    }

    let mut book_labels = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT b.content_hash, l.name
             FROM book_labels bl
             JOIN books b ON b.id = bl.book_id
             JOIN labels l ON l.id = bl.label_id
             ORDER BY b.id, l.id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ManifestBookLabel {
                book: row.get(0)?,
                label: row.get(1)?,
            })
        })?;
        for row in rows {
            book_labels.push(row?);
        }
    }

    let mut settings = Vec::new();
    {
        let mut statement =
            conn.prepare("SELECT key, value, updated_at FROM settings ORDER BY key")?;
        let rows = statement.query_map([], |row| {
            Ok(ManifestSetting {
                key: row.get(0)?,
                value: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        for row in rows {
            let setting: ManifestSetting = row?;
            if !DEVICE_LOCAL_SETTINGS.contains(&setting.key.as_str()) {
                settings.push(setting);
            }
        }
    }

    let mut downloads = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT d.md5, d.title, d.authors, d.year, d.format, d.source, d.mirror_urls,
                    d.state, d.bytes, d.total_bytes, d.error, d.error_code, b.content_hash,
                    d.filename, d.created_at, d.updated_at, d.finished_at
             FROM downloads d LEFT JOIN books b ON b.id = d.book_id
             ORDER BY d.created_at, d.id",
        )?;
        let rows = statement.query_map([], |row| {
            let authors_json: String = row.get(2)?;
            let mirror_json: String = row.get(6)?;
            Ok(ManifestDownload {
                md5: row.get(0)?,
                title: row.get(1)?,
                authors: serde_json::from_str(&authors_json).unwrap_or_default(),
                year: row.get(3)?,
                format: row.get(4)?,
                source: row.get(5)?,
                mirror_urls: serde_json::from_str(&mirror_json).unwrap_or_default(),
                state: row.get(7)?,
                bytes: row.get(8)?,
                total_bytes: row.get(9)?,
                error: row.get(10)?,
                error_code: row.get(11)?,
                book: row.get(12)?,
                filename: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                finished_at: row.get(16)?,
            })
        })?;
        for row in rows {
            downloads.push(row?);
        }
    }

    Ok(BackupManifest {
        kind: BACKUP_KIND.to_owned(),
        schema_version: BACKUP_FORMAT_VERSION,
        exported_at: unix_timestamp(),
        shelves,
        books,
        labels,
        book_labels,
        reading_states,
        annotations,
        settings,
        downloads,
    })
}

fn read_archive(bytes: &[u8]) -> Result<(BackupManifest, HashMap<String, Vec<u8>>)> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(zip_error)?;

    let manifest_bytes = {
        let mut entry = archive
            .by_name(MANIFEST_NAME)
            .map_err(|_| Error::ArchiveCorrupt {
                message: format!("{MANIFEST_NAME} is missing"),
            })?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| Error::ArchiveCorrupt {
                message: error.to_string(),
            })?;
        bytes
    };

    let header: BackupHeader =
        serde_json::from_slice(&manifest_bytes).map_err(|error| Error::ArchiveCorrupt {
            message: format!("{MANIFEST_NAME} is not readable: {error}"),
        })?;
    if header.kind != BACKUP_KIND {
        return Err(Error::ArchiveWrongSchema);
    }
    if header.schema_version != BACKUP_FORMAT_VERSION {
        return Err(Error::ArchiveUnsupportedVersion {
            found: header.schema_version,
            supported: BACKUP_FORMAT_VERSION,
        });
    }

    let manifest: BackupManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|error| Error::ArchiveCorrupt {
            message: error.to_string(),
        })?;

    let mut covers = HashMap::new();
    for book in &manifest.books {
        let Some(name) = &book.cover_file else {
            continue;
        };
        if !name.starts_with(&format!("{COVERS_DIR}/")) || name.contains("..") {
            continue;
        }
        if let Ok(mut entry) = archive.by_name(name) {
            let mut cover_bytes = Vec::new();
            if entry.read_to_end(&mut cover_bytes).is_ok() {
                covers.insert(name.clone(), cover_bytes);
            }
        }
        // A missing optional cover is not an error: metadata still restores.
    }

    Ok((manifest, covers))
}

fn validate(manifest: &BackupManifest) -> Result<()> {
    let mut ordinals = HashSet::new();
    for shelf in &manifest.shelves {
        if shelf.ordinal < 0 || shelf.capacity <= 0 {
            return Err(corrupt("a shelf has an invalid ordinal or capacity"));
        }
        if !ordinals.insert(shelf.ordinal) {
            return Err(corrupt("two shelves share an ordinal"));
        }
    }

    let mut label_names = HashSet::new();
    for label in &manifest.labels {
        let name = label.name.trim();
        if name.is_empty() || label.colour.trim().is_empty() {
            return Err(corrupt("a label has no name or no colour"));
        }
        if !label_names.insert(name.to_ascii_lowercase()) {
            return Err(corrupt("two labels share a name"));
        }
    }

    let mut hashes = HashSet::new();
    let mut placements = HashSet::new();
    for book in &manifest.books {
        if book.content_hash.trim().is_empty() || !hashes.insert(book.content_hash.clone()) {
            return Err(corrupt("a book has a missing or duplicate content hash"));
        }
        match (book.shelf_ordinal, book.slot_index) {
            (None, None) => {}
            (Some(ordinal), Some(slot)) => {
                if !ordinals.contains(&ordinal) || slot < 0 {
                    return Err(corrupt("a book points at a missing shelf or negative slot"));
                }
                if !placements.insert((ordinal, slot)) {
                    return Err(corrupt("two books share a shelf slot"));
                }
            }
            _ => return Err(corrupt("a book has only half a placement")),
        }
    }

    for link in &manifest.book_labels {
        if !hashes.contains(&link.book) || !label_names.contains(&link.label.to_ascii_lowercase()) {
            return Err(corrupt(
                "a book-label link points at a missing book or label",
            ));
        }
    }
    for state in &manifest.reading_states {
        if !hashes.contains(&state.book) {
            return Err(corrupt("a reading state points at a missing book"));
        }
        if !(0.0..=1.0).contains(&state.progress) {
            return Err(corrupt("a reading position is outside 0..1"));
        }
    }
    for annotation in &manifest.annotations {
        if !hashes.contains(&annotation.book) || annotation.locator.trim().is_empty() {
            return Err(corrupt("an annotation points at a missing book or locator"));
        }
    }
    for setting in &manifest.settings {
        if setting.key.trim().is_empty() {
            return Err(corrupt("a setting has no key"));
        }
    }
    for download in &manifest.downloads {
        if let Some(book) = &download.book
            && !hashes.contains(book)
        {
            return Err(corrupt("a download points at a missing book"));
        }
    }

    Ok(())
}

fn merge(
    tx: &Transaction<'_>,
    cover_dir: &Path,
    manifest: &BackupManifest,
    covers: &HashMap<String, Vec<u8>>,
) -> Result<BackupReport> {
    let mut report = BackupReport {
        mode: ImportMode::Merge,
        matched: 0,
        new: 0,
        skipped: 0,
        replaced: 0,
    };

    // Add shelves the archive has and this library does not. Existing shelves
    // keep their capacity.
    for shelf in &manifest.shelves {
        let exists: Option<i64> = tx
            .query_row(
                "SELECT id FROM shelves WHERE ordinal = ?1",
                [shelf.ordinal],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            tx.execute(
                "INSERT INTO shelves (ordinal, capacity) VALUES (?1, ?2)",
                params![shelf.ordinal, shelf.capacity],
            )?;
        }
    }

    let mut label_ids: HashMap<String, i64> = HashMap::new();
    for label in &manifest.labels {
        let id: Option<i64> = tx
            .query_row(
                "SELECT id FROM labels WHERE name = ?1 COLLATE NOCASE",
                [&label.name],
                |row| row.get(0),
            )
            .optional()?;
        let id = match id {
            Some(id) => id,
            None => {
                tx.execute(
                    "INSERT INTO labels (name, colour, created_at) VALUES (?1, ?2, ?3)",
                    params![label.name.trim(), label.colour, label.created_at],
                )?;
                tx.last_insert_rowid()
            }
        };
        label_ids.insert(label.name.to_ascii_lowercase(), id);
    }

    let default_capacity = read_shelf_capacity(tx)?;
    let mut spaces = load_spaces(tx)?;
    let mut book_ids: HashMap<String, i64> = HashMap::new();

    for book in &manifest.books {
        if let Some(id) = find_book(tx, &book.content_hash)? {
            report.matched += 1;
            book_ids.insert(book.content_hash.clone(), id);
            // Filling a missing cover is additive; an existing cover wins.
            if let Some(path) = install_cover(cover_dir, &book.content_hash, book, covers) {
                tx.execute(
                    "UPDATE books SET cover_path = COALESCE(cover_path, ?1),
                                      cover_source = COALESCE(cover_source, ?2)
                     WHERE id = ?3",
                    params![path, book.cover_source, id],
                )?;
            }
            install_provenance(tx, id, book)?;
            continue;
        }

        report.new += 1;
        let (shelf_id, slot_index) = place_book(
            tx,
            &mut spaces,
            default_capacity,
            book.shelf_ordinal,
            book.slot_index,
        )?;
        let cover_path = install_cover(cover_dir, &book.content_hash, book, covers);
        let file_cover_path = install_file_cover(cover_dir, &book.content_hash, book, covers)
            .or_else(|| cover_path.clone());
        insert_book(
            tx,
            book,
            Some(shelf_id),
            Some(slot_index),
            cover_path.as_deref(),
            file_cover_path.as_deref(),
        )?;
        let id = tx.last_insert_rowid();
        install_provenance(tx, id, book)?;
        book_ids.insert(book.content_hash.clone(), id);
    }

    for link in &manifest.book_labels {
        let (Some(book_id), Some(label_id)) = (
            book_ids.get(&link.book),
            label_ids.get(&link.label.to_ascii_lowercase()),
        ) else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO book_labels (book_id, label_id) VALUES (?1, ?2)",
            params![book_id, label_id],
        )?;
    }

    for state in &manifest.reading_states {
        let Some(book_id) = book_ids.get(&state.book) else {
            continue;
        };
        match read_reading_state(tx, *book_id)? {
            None => insert_reading_state(tx, *book_id, state)?,
            Some(existing) if is_newer(state, &existing) => {
                update_reading_state(tx, *book_id, state)?;
            }
            Some(_) => report.skipped += 1,
        }
    }

    for annotation in &manifest.annotations {
        let Some(book_id) = book_ids.get(&annotation.book) else {
            continue;
        };
        tx.execute(
            "INSERT INTO annotations
                 (book_id, kind, colour, note, locator, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
             WHERE NOT EXISTS (
                 SELECT 1 FROM annotations
                 WHERE book_id = ?1 AND kind = ?2 AND locator = ?5 AND created_at = ?6
             )",
            params![
                book_id,
                annotation.kind,
                annotation.colour,
                annotation.note,
                annotation.locator,
                annotation.created_at,
                annotation.updated_at
            ],
        )?;
    }

    for setting in &manifest.settings {
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![setting.key, setting.value, setting.updated_at],
        )?;
    }

    for download in &manifest.downloads {
        let book_id = download
            .book
            .as_ref()
            .and_then(|hash| book_ids.get(hash))
            .copied();
        let exists: Option<i64> = tx
            .query_row(
                "SELECT id FROM downloads WHERE md5 = ?1 AND created_at = ?2 AND title = ?3",
                params![download.md5, download.created_at, download.title],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            insert_download(tx, download, book_id)?;
        }
    }

    Ok(report)
}

fn replace(
    tx: &Transaction<'_>,
    cover_dir: &Path,
    manifest: &BackupManifest,
    covers: &HashMap<String, Vec<u8>>,
) -> Result<BackupReport> {
    let mut matched = 0;
    let mut new = 0;
    for book in &manifest.books {
        if find_book(tx, &book.content_hash)?.is_some() {
            matched += 1;
        } else {
            new += 1;
        }
    }
    let existing: i64 = tx.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;

    // Clear catalogue metadata only. Book files live outside this database and
    // are never touched by a restore.
    tx.execute("DELETE FROM annotations", [])?;
    tx.execute("DELETE FROM reading_state", [])?;
    tx.execute("DELETE FROM book_labels", [])?;
    tx.execute("DELETE FROM downloads", [])?;
    tx.execute("DELETE FROM books", [])?;
    tx.execute("DELETE FROM labels", [])?;
    tx.execute("DELETE FROM shelves", [])?;
    // The SAF folder grant is device-local, not catalogue data. A restore must
    // not disconnect the library the user is currently reading from.
    tx.execute(
        "DELETE FROM settings WHERE key NOT IN ('library_folder_uri', 'library_folder_name')",
        [],
    )?;

    if manifest.shelves.is_empty() {
        tx.execute(
            "INSERT INTO shelves (ordinal, capacity) VALUES (0, ?1)",
            [DEFAULT_SHELF_CAPACITY],
        )?;
    }
    let mut shelf_ids: HashMap<i64, i64> = HashMap::new();
    for shelf in &manifest.shelves {
        tx.execute(
            "INSERT INTO shelves (ordinal, capacity) VALUES (?1, ?2)",
            params![shelf.ordinal, shelf.capacity],
        )?;
        shelf_ids.insert(shelf.ordinal, tx.last_insert_rowid());
    }

    let mut label_ids: HashMap<String, i64> = HashMap::new();
    for label in &manifest.labels {
        tx.execute(
            "INSERT INTO labels (name, colour, created_at) VALUES (?1, ?2, ?3)",
            params![label.name.trim(), label.colour, label.created_at],
        )?;
        label_ids.insert(label.name.to_ascii_lowercase(), tx.last_insert_rowid());
    }

    let mut book_ids: HashMap<String, i64> = HashMap::new();
    for book in &manifest.books {
        let shelf_id = book
            .shelf_ordinal
            .and_then(|ordinal| shelf_ids.get(&ordinal))
            .copied();
        let cover_path = install_cover(cover_dir, &book.content_hash, book, covers);
        let file_cover_path = install_file_cover(cover_dir, &book.content_hash, book, covers)
            .or_else(|| cover_path.clone());
        insert_book(
            tx,
            book,
            shelf_id,
            book.slot_index,
            cover_path.as_deref(),
            file_cover_path.as_deref(),
        )?;
        let id = tx.last_insert_rowid();
        install_provenance(tx, id, book)?;
        book_ids.insert(book.content_hash.clone(), id);
    }

    for link in &manifest.book_labels {
        let (Some(book_id), Some(label_id)) = (
            book_ids.get(&link.book),
            label_ids.get(&link.label.to_ascii_lowercase()),
        ) else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO book_labels (book_id, label_id) VALUES (?1, ?2)",
            params![book_id, label_id],
        )?;
    }

    for state in &manifest.reading_states {
        let Some(book_id) = book_ids.get(&state.book) else {
            continue;
        };
        insert_reading_state(tx, *book_id, state)?;
    }

    for annotation in &manifest.annotations {
        let Some(book_id) = book_ids.get(&annotation.book) else {
            continue;
        };
        tx.execute(
            "INSERT INTO annotations
                 (book_id, kind, colour, note, locator, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                book_id,
                annotation.kind,
                annotation.colour,
                annotation.note,
                annotation.locator,
                annotation.created_at,
                annotation.updated_at
            ],
        )?;
    }

    for setting in &manifest.settings {
        // Ignore device-local keys if an archive happens to carry them; the
        // current folder grant wins.
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![setting.key, setting.value, setting.updated_at],
        )?;
    }

    for download in &manifest.downloads {
        let book_id = download
            .book
            .as_ref()
            .and_then(|hash| book_ids.get(hash))
            .copied();
        insert_download(tx, download, book_id)?;
    }

    Ok(BackupReport {
        mode: ImportMode::Replace,
        matched,
        new,
        skipped: 0,
        replaced: existing as usize,
    })
}

fn find_book(conn: &Connection, hash: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM books WHERE content_hash = ?1",
            [hash],
            |row| row.get(0),
        )
        .optional()?)
}

fn read_shelf_capacity(conn: &Connection) -> Result<i64> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'shelf_capacity'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value
        .and_then(|value| value.parse().ok())
        .filter(|capacity| *capacity > 0)
        .unwrap_or(DEFAULT_SHELF_CAPACITY))
}

struct ShelfSpace {
    id: i64,
    ordinal: i64,
    capacity: i64,
    used: HashSet<i64>,
}

fn load_spaces(conn: &Connection) -> Result<Vec<ShelfSpace>> {
    let mut spaces = Vec::new();
    {
        let mut statement =
            conn.prepare("SELECT id, ordinal, capacity FROM shelves ORDER BY ordinal")?;
        let rows = statement.query_map([], |row| {
            Ok(ShelfSpace {
                id: row.get(0)?,
                ordinal: row.get(1)?,
                capacity: row.get(2)?,
                used: HashSet::new(),
            })
        })?;
        for row in rows {
            spaces.push(row?);
        }
    }
    let mut statement =
        conn.prepare("SELECT shelf_id, slot_index FROM books WHERE shelf_id IS NOT NULL")?;
    let rows = statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
    for row in rows {
        let (shelf_id, slot) = row?;
        if let Some(space) = spaces.iter_mut().find(|space| space.id == shelf_id) {
            space.used.insert(slot);
        }
    }
    Ok(spaces)
}

fn place_book(
    conn: &Connection,
    spaces: &mut Vec<ShelfSpace>,
    default_capacity: i64,
    preferred_ordinal: Option<i64>,
    preferred_slot: Option<i64>,
) -> Result<(i64, i64)> {
    if let (Some(ordinal), Some(slot)) = (preferred_ordinal, preferred_slot)
        && slot >= 0
        && let Some(space) = spaces.iter_mut().find(|space| space.ordinal == ordinal)
        && slot < space.capacity
        && !space.used.contains(&slot)
    {
        space.used.insert(slot);
        return Ok((space.id, slot));
    }

    for space in spaces.iter_mut() {
        if (space.used.len() as i64) < space.capacity {
            let mut slot = 0;
            while space.used.contains(&slot) {
                slot += 1;
            }
            space.used.insert(slot);
            return Ok((space.id, slot));
        }
    }

    let ordinal: i64 = conn.query_row(
        "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM shelves",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO shelves (ordinal, capacity) VALUES (?1, ?2)",
        params![ordinal, default_capacity],
    )?;
    let id = conn.last_insert_rowid();
    spaces.push(ShelfSpace {
        id,
        ordinal,
        capacity: default_capacity,
        used: HashSet::from([0]),
    });
    Ok((id, 0))
}

fn insert_book(
    conn: &Connection,
    book: &ManifestBook,
    shelf_id: Option<i64>,
    slot_index: Option<i64>,
    cover_path: Option<&str>,
    file_cover_path: Option<&str>,
) -> Result<()> {
    let authors = serde_json::to_string(&book.authors).map_err(json_error)?;
    conn.execute(
        // A restored book has no device-local path yet. The next scan matches it
        // by content hash and fills the path from the file it actually finds.
        "INSERT INTO books (
             content_hash, quick_key, path, format, title, authors, series, language,
             description, publisher, published_date, identifier, page_count, cover_path,
             cover_source, added_at, shelf_id, slot_index,
             file_cover_path, file_cover_source, file_description
         ) VALUES (?1, NULL, '', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            book.content_hash,
            book.format,
            book.title,
            authors,
            book.series,
            book.language,
            book.description,
            book.publisher,
            book.published_date,
            book.identifier,
            book.page_count,
            cover_path,
            book.cover_source,
            book.added_at,
            shelf_id,
            slot_index,
            file_cover_path,
            book.file_cover_source.or(book.cover_source),
            book.description,
        ],
    )?;
    Ok(())
}

fn install_file_cover(
    cover_dir: &Path,
    hash: &str,
    book: &ManifestBook,
    covers: &HashMap<String, Vec<u8>>,
) -> Option<String> {
    let bytes = covers.get(book.file_cover_file.as_deref()?)?;
    if bytes.is_empty() {
        return None;
    }
    let path = cover_dir.join(format!("{hash}-file.jpg"));
    if !path.is_file() {
        fs::create_dir_all(path.parent()?).ok()?;
        fs::write(&path, bytes).ok()?;
    }
    Some(path.to_string_lossy().into_owned())
}

fn install_provenance(conn: &Connection, book_id: i64, book: &ManifestBook) -> Result<()> {
    for entry in &book.provenance {
        if entry.field != "description" && entry.field != "cover" {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO field_provenance (book_id, field, source, source_url)
             VALUES (?1, ?2, ?3, ?4)",
            params![book_id, entry.field, entry.source, entry.source_url],
        )?;
    }
    Ok(())
}

fn install_cover(
    cover_dir: &Path,
    hash: &str,
    book: &ManifestBook,
    covers: &HashMap<String, Vec<u8>>,
) -> Option<String> {
    let bytes = covers.get(book.cover_file.as_deref()?)?;
    if bytes.is_empty() {
        return None;
    }
    let path = cover::cover_path(cover_dir, hash);
    if !path.is_file() {
        fs::create_dir_all(path.parent()?).ok()?;
        fs::write(&path, bytes).ok()?;
    }
    Some(path.to_string_lossy().into_owned())
}

struct ExistingReadingState {
    progress: f64,
    last_opened_at: Option<i64>,
    finished_at: Option<i64>,
}

fn read_reading_state(conn: &Connection, book_id: i64) -> Result<Option<ExistingReadingState>> {
    Ok(conn
        .query_row(
            "SELECT progress, last_opened_at, finished_at
             FROM reading_state WHERE book_id = ?1",
            [book_id],
            |row| {
                Ok(ExistingReadingState {
                    progress: row.get(0)?,
                    last_opened_at: row.get(1)?,
                    finished_at: row.get(2)?,
                })
            },
        )
        .optional()?)
}

fn is_newer(incoming: &ManifestReadingState, existing: &ExistingReadingState) -> bool {
    let incoming_recency = recency(incoming.last_opened_at, incoming.finished_at);
    let existing_recency = recency(existing.last_opened_at, existing.finished_at);
    if incoming_recency != existing_recency {
        return incoming_recency > existing_recency;
    }
    if incoming.finished_at.unwrap_or(0) != existing.finished_at.unwrap_or(0) {
        return incoming.finished_at.unwrap_or(0) > existing.finished_at.unwrap_or(0);
    }
    // A tie on timestamps still lets real forward progress through, but never
    // moves a reader backwards.
    incoming.progress > existing.progress
}

fn recency(last_opened_at: Option<i64>, finished_at: Option<i64>) -> i64 {
    last_opened_at.unwrap_or(0).max(finished_at.unwrap_or(0))
}

fn insert_reading_state(
    conn: &Connection,
    book_id: i64,
    state: &ManifestReadingState,
) -> Result<()> {
    conn.execute(
        "INSERT INTO reading_state
             (book_id, status, status_source, progress, locator, last_opened_at, finished_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            book_id,
            state.status,
            state.status_source,
            state.progress,
            state.locator,
            state.last_opened_at,
            state.finished_at
        ],
    )?;
    Ok(())
}

fn update_reading_state(
    conn: &Connection,
    book_id: i64,
    state: &ManifestReadingState,
) -> Result<()> {
    conn.execute(
        "UPDATE reading_state SET status = ?1, status_source = ?2, progress = ?3,
                                  locator = ?4, last_opened_at = ?5, finished_at = ?6
         WHERE book_id = ?7",
        params![
            state.status,
            state.status_source,
            state.progress,
            state.locator,
            state.last_opened_at,
            state.finished_at,
            book_id
        ],
    )?;
    Ok(())
}

fn insert_download(
    conn: &Connection,
    download: &ManifestDownload,
    book_id: Option<i64>,
) -> Result<()> {
    let authors = serde_json::to_string(&download.authors).map_err(json_error)?;
    let mirrors = serde_json::to_string(&download.mirror_urls).map_err(json_error)?;
    // A download that was running when the backup was taken is safe to resume.
    let state = if download.state == DownloadState::Running {
        DownloadState::Queued
    } else {
        download.state
    };
    conn.execute(
        "INSERT INTO downloads (
             md5, title, authors, year, format, source, mirror_urls, state, bytes,
             total_bytes, error, error_code, book_id, filename, created_at, updated_at,
             finished_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            download.md5,
            download.title,
            authors,
            download.year,
            download.format,
            download.source,
            mirrors,
            state,
            download.bytes,
            download.total_bytes,
            download.error,
            download.error_code,
            book_id,
            download.filename,
            download.created_at,
            download.updated_at,
            download.finished_at
        ],
    )?;
    Ok(())
}

fn corrupt(message: &str) -> Error {
    Error::ArchiveCorrupt {
        message: message.to_owned(),
    }
}

fn zip_error(error: zip::result::ZipError) -> Error {
    Error::ArchiveCorrupt {
        message: error.to_string(),
    }
}

fn json_error(error: serde_json::Error) -> Error {
    Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
