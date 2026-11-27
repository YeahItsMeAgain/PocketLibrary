//! Scanning a library folder and reconciling it with the catalogue.

use std::collections::{HashMap, HashSet};
use std::fs;

use rusqlite::params;

use super::placement::{NewBook, allocate_slot, insert_book, load_shelf_slots};
use super::{Service, read_setting, shelf_capacity, unix_timestamp};
use crate::error::Result;
use crate::models::{BookFormat, CoverSource, Placement, ScanIssue, ScanIssueReason, ScanReport};
use crate::source::{FileSource, ScannedBook, collect_books};
use crate::{cover, identity, metadata};

const COVER_RENDERER_VERSION: &str = "cover_renderer_version";
/// Bump when cover extraction changes enough that cached covers must be made
/// again. Version 2 skips PDF title pages in favour of a jacket-like page.
const COVER_RENDERER_VERSION_CURRENT: &str = "2";

impl Service {
    /// Walk `source` and reconcile the catalog with it by content hash.
    ///
    /// A renamed or moved file keeps its book id, shelf and reading state.
    /// Identical bytes at two paths produce one book. New hashes are parsed and
    /// placed on the lowest shelf with room. Hashes that vanished are marked
    /// finished and keep their records and spines. Running this twice changes
    /// nothing.
    pub fn scan(&self, source: &dyn FileSource) -> Result<ScanReport> {
        let found = collect_books(source)?;
        let now = unix_timestamp();
        let mut skipped = Vec::new();
        let mut hashed = Vec::with_capacity(found.len());

        // Quick keys already in the catalog let an unchanged rescan skip the
        // full read entirely. The full hash still decides duplicates.
        let known_quick_keys = {
            let conn = self.connection()?;
            let mut statement = conn
                .prepare("SELECT quick_key, content_hash FROM books WHERE quick_key IS NOT NULL")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<std::result::Result<HashMap<_, _>, _>>()?
        };

        for file in found {
            let quick = match source.read_quick(&file.handle) {
                Ok(quick) => quick,
                Err(_) => {
                    skipped.push(ScanIssue {
                        name: file.name,
                        reason: ScanIssueReason::Unreadable,
                    });
                    continue;
                }
            };
            let quick_key = identity::quick_key_from_parts(quick.length, &quick.head, &quick.tail);

            if let Some(content_hash) = known_quick_keys.get(&quick_key) {
                hashed.push(HashedFile {
                    quick_key,
                    content_hash: content_hash.clone(),
                    scanned: file,
                });
                continue;
            }

            match source.read_file(&file.handle) {
                Ok(bytes) => hashed.push(HashedFile {
                    quick_key: identity::quick_key(&bytes),
                    content_hash: identity::content_hash(&bytes),
                    scanned: file,
                }),
                Err(_) => skipped.push(ScanIssue {
                    name: file.name,
                    reason: ScanIssueReason::Unreadable,
                }),
            }
        }

        // Group by content so one file can never land twice. Groups keep first
        // discovery order, which is path order, so placement is stable.
        let mut order: Vec<String> = Vec::new();
        let mut groups: HashMap<String, Vec<HashedFile>> = HashMap::new();
        for file in hashed {
            let hash = file.content_hash.clone();
            if !groups.contains_key(&hash) {
                order.push(hash.clone());
            }
            groups.entry(hash).or_default().push(file);
        }

        let mut conn = self.connection()?;
        let tx = conn.transaction()?;

        let needs_cover_refresh = read_setting(&tx, COVER_RENDERER_VERSION)?.as_deref()
            != Some(COVER_RENDERER_VERSION_CURRENT);
        let mut existing: HashMap<String, ExistingBook> = HashMap::new();
        {
            let mut statement = tx
                .prepare("SELECT content_hash, id, path, title, format, cover_source FROM books")?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ExistingBook {
                        id: row.get(1)?,
                        path: row.get(2)?,
                        title: row.get(3)?,
                        format: row.get(4)?,
                        cover_source: row.get(5)?,
                    },
                ))
            })?;
            for row in rows {
                let (hash, book) = row?;
                existing.insert(hash, book);
            }
        }

        let mut shelves = load_shelf_slots(&tx)?;
        let capacity = shelf_capacity(&tx)?;
        let mut added = 0usize;
        let mut removed = 0usize;
        let mut relinked = 0usize;
        let mut duplicates = 0usize;
        let mut placements = Vec::new();
        let mut touched: HashSet<String> = HashSet::new();

        for hash in order {
            let group = &groups[&hash];
            duplicates += group.len().saturating_sub(1);
            let representative = &group[0];

            if let Some(known) = existing.get(&hash) {
                touched.insert(hash.clone());
                if let Some(title) =
                    metadata::repaired_filename_title(&known.title, &representative.scanned.name)
                {
                    tx.execute(
                        "UPDATE books SET title = ?1 WHERE id = ?2",
                        params![title, known.id],
                    )?;
                }
                if needs_cover_refresh
                    && known.format == BookFormat::Pdf
                    && known.cover_source == Some(CoverSource::Rendered)
                    && let Ok(bytes) = source.read_file(&representative.scanned.handle)
                    && let Ok(parsed) = metadata::extract(
                        representative.scanned.format,
                        &bytes,
                        &representative.scanned.name,
                    )
                {
                    let cached = cover::cover_path(&self.cover_dir, &hash);
                    let _ = fs::remove_file(cached);
                    let refreshed = cover::ensure(
                        &self.cover_dir,
                        &hash,
                        parsed.cover.as_deref(),
                        if parsed.cover_rendered {
                            CoverSource::Rendered
                        } else {
                            CoverSource::Embedded
                        },
                    );
                    if let Some((cover_path, cover_source)) = refreshed {
                        tx.execute(
                            "UPDATE books SET cover_path = ?1, cover_source = ?2 WHERE id = ?3",
                            params![cover_path.to_string_lossy(), cover_source, known.id],
                        )?;
                    }
                }
                if !group.iter().any(|file| file.scanned.path == known.path) {
                    tx.execute(
                        "UPDATE books SET path = ?1, quick_key = ?2 WHERE content_hash = ?3",
                        params![representative.scanned.path, representative.quick_key, hash],
                    )?;
                    relinked += 1;
                }
                continue;
            }

            let bytes = match source.read_file(&representative.scanned.handle) {
                Ok(bytes) => bytes,
                Err(_) => {
                    skipped.push(ScanIssue {
                        name: representative.scanned.name.clone(),
                        reason: ScanIssueReason::Unreadable,
                    });
                    continue;
                }
            };
            let parsed = match metadata::extract(
                representative.scanned.format,
                &bytes,
                &representative.scanned.name,
            ) {
                Ok(parsed) => parsed,
                Err(reason) => {
                    skipped.push(ScanIssue {
                        name: representative.scanned.name.clone(),
                        reason,
                    });
                    continue;
                }
            };

            let cover = cover::ensure(
                &self.cover_dir,
                &hash,
                parsed.cover.as_deref(),
                if parsed.cover_rendered {
                    CoverSource::Rendered
                } else {
                    CoverSource::Embedded
                },
            );

            let (shelf_id, slot_index, shelf_ordinal, appended_shelf) =
                allocate_slot(&tx, &mut shelves, capacity)?;
            insert_book(
                &tx,
                NewBook {
                    scanned: &representative.scanned,
                    content_hash: &hash,
                    quick_key: &representative.quick_key,
                    metadata: &parsed,
                    cover: cover.as_ref(),
                    shelf_id,
                    slot_index,
                    added_at: now,
                },
            )?;
            let book_id = tx.last_insert_rowid();
            existing.insert(
                hash.clone(),
                ExistingBook {
                    id: book_id,
                    path: representative.scanned.path.clone(),
                    title: parsed.title.clone().unwrap_or_default(),
                    format: representative.scanned.format,
                    cover_source: cover.as_ref().map(|(_, source)| *source),
                },
            );
            placements.push(Placement {
                book_id,
                shelf_id,
                shelf_ordinal,
                appended_shelf,
            });
            touched.insert(hash.clone());
            added += 1;
        }

        for (hash, known) in &existing {
            if touched.contains(hash) {
                continue;
            }
            // A finished book stays finished. For the first transition, update
            // only the status so an in-progress read keeps its progress and
            // manual/automatic source.
            let changed = tx.execute(
                "INSERT INTO reading_state (book_id, status, status_source, progress, finished_at)
                 VALUES (?1, 'finished', 'auto', 1, ?2)
                 ON CONFLICT(book_id) DO UPDATE SET
                     status = 'finished',
                     finished_at = excluded.finished_at
                 WHERE reading_state.status <> 'finished'",
                params![known.id, now],
            )?;
            removed += changed;
        }

        if needs_cover_refresh {
            tx.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![
                    COVER_RENDERER_VERSION,
                    COVER_RENDERER_VERSION_CURRENT,
                    unix_timestamp()
                ],
            )?;
        }

        let total: i64 = tx.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;
        tx.commit()?;

        Ok(ScanReport {
            total: total as usize,
            added,
            relinked,
            removed,
            duplicates,
            skipped,
            placements,
        })
    }
}

struct HashedFile {
    scanned: ScannedBook,
    content_hash: String,
    quick_key: String,
}

struct ExistingBook {
    id: i64,
    path: String,
    title: String,
    format: BookFormat,
    cover_source: Option<CoverSource>,
}
