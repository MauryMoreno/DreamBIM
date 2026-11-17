//! Reading and writing whole files. Every command checks the extension: they must not serve to read or
//! write arbitrary files. Errors are English text meant to be shown as is in the UI.

use tauri::State;

use crate::fs::{atomic::write_atomic, blocking, extensions::has_extension, scope::FsScope};

/// What `read_binary_file` may read: Excel workbooks, Word documents, PDFs, images (for OCR), CSV and text
/// (classification tables and price documents).
const READABLE_BINARY_EXTENSIONS: &[&str] = &["xlsx", "docx", "pdf", "jpg", "jpeg", "png", "csv", "tsv", "txt"];

/// Reads an `.ifcx` or `.csv` file (UTF-8). Rejects any other extension.
fn read_text(path: &str) -> Result<String, String> {
    if !has_extension(path, &["ifcx", "csv"]) {
        return Err("Only .ifcx files can be opened".to_string());
    }
    std::fs::read_to_string(path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Saves an `.ifcx` or `.csv` file (UTF-8) atomically. Rejects any other extension.
fn write_text(path: &str, contents: &str) -> Result<(), String> {
    if !has_extension(path, &["ifcx", "csv"]) {
        return Err("Only .ifcx files can be saved".to_string());
    }
    write_atomic(std::path::Path::new(path), contents.as_bytes())
}

/// Reads a file as bytes: `.xlsx`, `.docx`, `.pdf`, `.jpg`, `.png`, `.csv`, `.tsv` or `.txt`. Rejects any other extension.
fn read_binary(path: &str) -> Result<Vec<u8>, String> {
    if !has_extension(path, READABLE_BINARY_EXTENSIONS) {
        return Err("Only PDF, Excel (.xlsx), Word (.docx), image (.jpg, .png), CSV or text files can be opened".to_string());
    }
    std::fs::read(path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Saves an `.xlsx` file (binary) atomically. Rejects any other extension.
fn write_binary(path: &str, contents: &[u8]) -> Result<(), String> {
    if !has_extension(path, &["xlsx"]) {
        return Err("Only .xlsx files can be saved".to_string());
    }
    write_atomic(std::path::Path::new(path), contents)
}

#[tauri::command]
pub async fn read_text_file(scope: State<'_, FsScope>, path: String) -> Result<String, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&path)?;
        read_text(&path)
    })
    .await
}

#[tauri::command]
pub async fn write_text_file(scope: State<'_, FsScope>, path: String, contents: String) -> Result<(), String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&path)?;
        write_text(&path, &contents)
    })
    .await
}

/// The bytes travel as a raw IPC response (an `ArrayBuffer` in the frontend), not as a JSON array of numbers.
#[tauri::command]
pub async fn read_binary_file(scope: State<'_, FsScope>, path: String) -> Result<tauri::ipc::Response, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&path)?;
        read_binary(&path)
    })
    .await
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn write_binary_file(scope: State<'_, FsScope>, path: String, contents: Vec<u8>) -> Result<(), String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&path)?;
        write_binary(&path, &contents)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dream_bim_files_{}_{}", std::process::id(), name))
    }

    fn temp_file(name: &str, contents: &str) -> PathBuf {
        let path = temp_path(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn read_text_file_reads_the_contents() {
        let path = temp_file("reads.ifcx", "hello");
        let result = read_text(&path.to_string_lossy());
        std::fs::remove_file(&path).ok();
        assert_eq!(result, Ok("hello".to_string()));
    }

    #[test]
    fn read_text_file_error_is_english() {
        let path = std::env::temp_dir().join("dream_bim_never_exists.ifcx");
        match read_text(&path.to_string_lossy()) {
            Err(e) => assert!(e.starts_with("Could not read"), "unexpected message: {e}"),
            Ok(_) => panic!("an error was expected"),
        }
    }

    #[test]
    fn read_text_file_accepts_ifcx_in_any_case() {
        let path = temp_file("upper.IFCX", "hello");
        let result = read_text(&path.to_string_lossy());
        std::fs::remove_file(&path).ok();
        assert_eq!(result, Ok("hello".to_string()));
    }

    #[test]
    fn read_text_file_rejects_other_extensions() {
        for name in ["rejects.txt", "no_extension"] {
            let path = temp_file(name, "secret");
            let result = read_text(&path.to_string_lossy());
            std::fs::remove_file(&path).ok();
            assert_eq!(result, Err("Only .ifcx files can be opened".to_string()), "{name}");
        }
    }

    #[test]
    fn write_text_file_writes_and_overwrites() {
        let path = temp_path("writes.ifcx");
        let p = path.to_string_lossy().into_owned();
        assert_eq!(write_text(&p, "one"), Ok(()));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one");
        assert_eq!(write_text(&p, "two"), Ok(()));
        let read = std::fs::read_to_string(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(read, "two");
    }

    #[test]
    fn csv_is_read_and_written_as_text() {
        let path = temp_path("prices.csv");
        let p = path.to_string_lossy().into_owned();
        assert_eq!(write_text(&p, "code;price\nA;1,5\n"), Ok(()));
        let read = read_text(&p);
        std::fs::remove_file(&path).ok();
        assert_eq!(read, Ok("code;price\nA;1,5\n".to_string()));
    }

    #[test]
    fn write_binary_file_writes_xlsx_and_rejects_other_extensions() {
        let path = temp_path("boq.xlsx");
        let p = path.to_string_lossy().into_owned();
        assert_eq!(write_binary(&p, &[0x50, 0x4b, 0x03, 0x04, 0xff]), Ok(()));
        let read = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(read, vec![0x50, 0x4b, 0x03, 0x04, 0xff]);
        assert!(!std::path::Path::new(&format!("{}.tmp", path.to_string_lossy())).exists());

        let other = temp_path("boq.csv");
        let result = write_binary(&other.to_string_lossy(), &[1]);
        let created = other.exists();
        std::fs::remove_file(&other).ok();
        assert_eq!(result, Err("Only .xlsx files can be saved".to_string()));
        assert!(!created);
    }

    #[test]
    fn read_binary_file_reads_documents_images_and_text_and_rejects_other_extensions() {
        for name in ["table.xlsx", "quote.docx", "offer.PDF", "photo.jpg", "scan.JPEG", "capture.png", "Prices.CSV", "list.tsv", "list.txt"] {
            let path = temp_path(name);
            std::fs::write(&path, [0x50u8, 0x4b, 0x03, 0x04, 0xff]).unwrap();
            let read = read_binary(&path.to_string_lossy());
            std::fs::remove_file(&path).ok();
            assert_eq!(read, Ok(vec![0x50, 0x4b, 0x03, 0x04, 0xff]), "{name}");
        }

        let other = temp_file("table_r.ifcx", "x");
        let result = read_binary(&other.to_string_lossy());
        std::fs::remove_file(&other).ok();
        assert_eq!(result, Err("Only PDF, Excel (.xlsx), Word (.docx), image (.jpg, .png), CSV or text files can be opened".to_string()));
    }

    #[test]
    fn write_text_file_rejects_other_extensions() {
        for name in ["rejects_w.txt", "no_extension_w"] {
            let path = temp_path(name);
            let result = write_text(&path.to_string_lossy(), "x");
            let created = path.exists();
            std::fs::remove_file(&path).ok();
            assert_eq!(result, Err("Only .ifcx files can be saved".to_string()), "{name}");
            assert!(!created, "{name}");
        }
    }

    #[test]
    fn write_text_file_fails_in_a_missing_folder() {
        let path = temp_path("missing_dir").join("sub").join("x.ifcx");
        match write_text(&path.to_string_lossy(), "x") {
            Err(e) => assert!(e.starts_with("Could not save"), "unexpected message: {e}"),
            Ok(()) => panic!("an error was expected"),
        }
    }

    #[test]
    fn write_text_file_leaves_no_temporary_file() {
        let path = temp_path("no_tmp.ifcx");
        let p = path.to_string_lossy().into_owned();
        let result = write_text(&p, "x");
        let tmp_exists = std::path::Path::new(&format!("{p}.tmp")).exists();
        std::fs::remove_file(&path).ok();
        assert_eq!(result, Ok(()));
        assert!(!tmp_exists);
    }
}
