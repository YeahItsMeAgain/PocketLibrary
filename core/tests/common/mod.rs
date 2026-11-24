#![allow(dead_code)]
//! Shared host-test fixtures: an in-memory SAF stand-in and generated books.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::Path;

use pocketlibrary_core::{Api, Error, FileSource, Result, SourceEntry, SourceKind};
use tempfile::TempDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// A small in-memory directory tree that stands in for SAF in host tests.
#[derive(Default)]
pub struct FakeDir {
    dirs: HashMap<String, Vec<SourceEntry>>,
    files: HashMap<String, Vec<u8>>,
    failures: HashSet<String>,
    root_missing: bool,
}

impl FakeDir {
    pub fn new() -> Self {
        let mut dirs = HashMap::new();
        dirs.insert(String::new(), Vec::new());
        Self {
            dirs,
            ..Self::default()
        }
    }

    /// Add a valid fixture book whose bytes are unique to its path.
    pub fn file(self, path: &str) -> Self {
        let bytes = fixture_for(path);
        self.file_with(path, bytes)
    }

    pub fn file_with(mut self, path: &str, bytes: Vec<u8>) -> Self {
        let (parent, name) = split(path);
        self.dirs
            .entry(parent.to_owned())
            .or_default()
            .push(SourceEntry {
                name: name.to_owned(),
                path: path.to_owned(),
                kind: SourceKind::File,
                handle: path.to_owned(),
            });
        self.files.insert(path.to_owned(), bytes);
        self
    }

    pub fn dir(mut self, path: &str) -> Self {
        let (parent, name) = split(path);
        self.dirs
            .entry(parent.to_owned())
            .or_default()
            .push(SourceEntry {
                name: name.to_owned(),
                path: path.to_owned(),
                kind: SourceKind::Directory,
                handle: path.to_owned(),
            });
        self.dirs.entry(path.to_owned()).or_default();
        self
    }

    pub fn failing_dir(mut self, path: &str) -> Self {
        self = self.dir(path);
        self.failures.insert(path.to_owned());
        self
    }

    pub fn missing() -> Self {
        Self {
            root_missing: true,
            ..Self::default()
        }
    }

    pub fn bytes(&self, path: &str) -> Vec<u8> {
        self.files
            .get(path)
            .unwrap_or_else(|| panic!("fixture {path} exists"))
            .clone()
    }
}

impl FileSource for FakeDir {
    fn list(&self, dir_handle: Option<&str>) -> Result<Vec<SourceEntry>> {
        let key = dir_handle.unwrap_or("");
        if self.root_missing {
            return Err(Error::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "folder is gone",
            )));
        }
        if self.failures.contains(key) {
            return Err(Error::Io(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("cannot list {key}"),
            )));
        }
        self.dirs
            .get(key)
            .cloned()
            .ok_or_else(|| Error::Io(std::io::Error::from(std::io::ErrorKind::NotFound)))
    }

    fn read_file(&self, handle: &str) -> Result<Vec<u8>> {
        self.files.get(handle).cloned().ok_or_else(|| {
            Error::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("cannot read {handle}"),
            ))
        })
    }
}

fn split(path: &str) -> (&str, &str) {
    match path.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => ("", path),
    }
}

pub fn database() -> (TempDir, Api) {
    let (dir, _path, api) = database_at();
    (dir, api)
}

pub fn database_at() -> (TempDir, std::path::PathBuf, Api) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    let api = Api::open(&path).expect("open catalog");
    (dir, path, api)
}

pub fn book_id_at(path: &Path, book_path: &str) -> i64 {
    let conn = rusqlite::Connection::open(path).expect("open catalog directly");
    conn.query_row("SELECT id FROM books WHERE path = ?1", [book_path], |row| {
        row.get(0)
    })
    .expect("book exists")
}

pub fn book_id_for_file(path: &Path, file_name: &str) -> i64 {
    let conn = rusqlite::Connection::open(path).expect("open catalog directly");
    conn.query_row(
        "SELECT id FROM books WHERE path = ?1 OR path LIKE ?2",
        [file_name, &format!("%/{file_name}")],
        |row| row.get(0),
    )
    .expect("book exists")
}

pub fn book_row(path: &Path, id: i64) -> (String, String, Option<String>) {
    let conn = rusqlite::Connection::open(path).expect("open catalog directly");
    conn.query_row(
        "SELECT content_hash, path, quick_key FROM books WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .expect("book row exists")
}

/// Valid-looking fixture bytes for a path, unique per path.
pub fn fixture_for(path: &str) -> Vec<u8> {
    if path.to_ascii_lowercase().ends_with(".epub") {
        minimal_epub(path)
    } else {
        minimal_pdf(path)
    }
}

/// Build a minimal EPUB 3 container. The unique marker keeps hashes distinct.
pub fn minimal_epub(marker: &str) -> Vec<u8> {
    epub_with(marker, &[], None)
}

/// Build an EPUB with the supplied metadata rows and an optional cover image.
///
/// `metadata` entries are raw OPF `dc:`/`meta:` fragments.
pub fn epub_with(marker: &str, metadata: &[String], cover: Option<&[u8]>) -> Vec<u8> {
    let mut opf_meta = format!(
        r#"<dc:identifier id="bookid">urn:uuid:{}</dc:identifier><dc:language>en</dc:language>"#,
        marker.replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );
    for entry in metadata {
        opf_meta.push_str(entry);
    }

    let cover_manifest = if cover.is_some() {
        r#"<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>"#
    } else {
        ""
    };
    let opf = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">{opf_meta}</metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    {cover_manifest}
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>"#
    );
    let container = r#"<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;
    let chapter = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><p>Text.</p></body></html>"#;

    let mut buffer = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut buffer);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, contents) in [
            ("mimetype", b"application/epub+zip".to_vec()),
            ("META-INF/container.xml", container.as_bytes().to_vec()),
            ("OEBPS/content.opf", opf.into_bytes()),
            ("OEBPS/chapter.xhtml", chapter.as_bytes().to_vec()),
            ("OEBPS/unique.txt", marker.as_bytes().to_vec()),
        ] {
            zip.start_file(name, options).expect("zip entry");
            std::io::Write::write_all(&mut zip, &contents).expect("write entry");
        }
        if let Some(cover) = cover {
            zip.start_file("OEBPS/cover.png", options)
                .expect("cover entry");
            std::io::Write::write_all(&mut zip, cover).expect("write cover");
        }
        zip.finish().expect("finish epub");
    }
    buffer.into_inner()
}

/// A rich EPUB used by metadata and cover tests.
pub fn rich_epub(cover: Option<&[u8]>) -> Vec<u8> {
    epub_with(
        "rich-book",
        &[
            "<dc:title>The Dispossessed</dc:title>".to_owned(),
            "<dc:creator>Ursula K. Le Guin</dc:creator>".to_owned(),
            "<dc:description>&lt;p&gt;A quiet &lt;b&gt;revolution&lt;/b&gt;.&lt;/p&gt;</dc:description>"
                .to_owned(),
            "<dc:publisher>Harper &amp; Row</dc:publisher>".to_owned(),
            "<dc:date>1974-05-01</dc:date>".to_owned(),
            "<meta property=\"belongs-to-collection\" id=\"series\">Hainish</meta>".to_owned(),
            "<meta refines=\"#series\" property=\"collection-type\">series</meta>".to_owned(),
        ],
        cover,
    )
}

pub fn png_cover(width: u32, height: u32) -> Vec<u8> {
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        width,
        height,
        image::Rgb([190, 80, 60]),
    ));
    let mut bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
        .expect("encode fixture cover");
    bytes
}

/// A minimal one-page PDF. `title`/`author` are omitted when `None`.
pub fn pdf_with(marker: &str, title: Option<&str>, author: Option<&str>) -> Vec<u8> {
    use lopdf::{Document, Object, Stream, dictionary};

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content_id = doc.add_object(Stream::new(
        dictionary! {},
        b"0.12 0.06 0.16 rg 0 0 300 400 re f".to_vec(),
    ));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 300.into(), 400.into()],
        "Contents" => content_id,
        "Resources" => dictionary! {},
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let mut info = dictionary! { "Producer" => Object::string_literal(marker.to_owned()) };
    if let Some(title) = title {
        info.set("Title", Object::string_literal(title.to_owned()));
    }
    if let Some(author) = author {
        info.set("Author", Object::string_literal(author.to_owned()));
    }
    let info_id = doc.add_object(info);
    doc.trailer.set("Info", info_id);

    let mut buffer = Cursor::new(Vec::new());
    doc.save_to(&mut buffer).expect("save fixture pdf");
    buffer.into_inner()
}

pub fn minimal_pdf(marker: &str) -> Vec<u8> {
    pdf_with(marker, None, None)
}
