//! Listing and searching folders: the library of `.ifcx` files and the project folder of the Docs screen.

use tauri::State;

use crate::fs::{
    blocking,
    entries::{list_entries, modified_ms, modified_ms_opt, FileEntry},
    extensions::has_extension,
    scope::FsScope,
};

/// At most this many entries are visited: a huge folder (Documents) must not hang the search.
const SEARCH_MAX_VISITED: usize = 20_000;
const SEARCH_MAX_DEPTH: usize = 6;

/// Lists a folder with everything in it (subfolders and files of any type, no hidden ones), folders first and by
/// name ignoring case. This is what Docs shows of the project folder.
fn folder_listing(dir: &str) -> Result<Vec<FileEntry>, String> {
    list_entries(dir, |_, _| true, true)
}

#[tauri::command]
pub async fn list_folder(scope: State<'_, FsScope>, dir: String) -> Result<Vec<FileEntry>, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&dir)?;
        folder_listing(&dir)
    })
    .await
}

/// Lists a library folder: its subfolders and its `.ifcx` files (no hidden ones), folders first and by name
/// ignoring case. Errors are English text meant to be shown as is in the UI.
fn library_listing(dir: &str) -> Result<Vec<FileEntry>, String> {
    list_entries(dir, |name, is_dir| is_dir || has_extension(name, &["ifcx"]), false)
}

#[tauri::command]
pub async fn list_library(scope: State<'_, FsScope>, dir: String) -> Result<Vec<FileEntry>, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&dir)?;
        library_listing(&dir)
    })
    .await
}

/// Does the path exist on disk?
fn exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

#[tauri::command]
/// A path outside the opened folders is reported as missing: probing must not reveal what is on the disk.
pub async fn path_exists(scope: State<'_, FsScope>, path: String) -> Result<bool, String> {
    let scope = scope.inner().clone();
    blocking::run(move || Ok(scope.check(&path).is_ok() && exists(&path))).await
}

/// Modification date of a file in ms since the Unix epoch, or None if it does not exist. Studio watches it to
/// reload the open document when it changes on disk.
fn mtime(path: &str) -> Option<u64> {
    modified_ms_opt(&std::fs::metadata(path).ok()?)
}

#[tauri::command]
/// Outside the opened folders there is no date to give.
pub async fn file_mtime(scope: State<'_, FsScope>, path: String) -> Result<Option<u64>, String> {
    let scope = scope.inner().clone();
    blocking::run(move || Ok(if scope.check(&path).is_ok() { mtime(&path) } else { None })).await
}

/// Searches the whole library (subfolders down to 6 levels, no hidden ones) for `.ifcx` files whose name contains
/// `query`, ignoring case. Order: closest to the root first and, at the same level, by name; cut to `limit`.
fn search_library_in(dir: &str, query: &str, limit: usize, max_visited: usize) -> Result<Vec<FileEntry>, String> {
    let q = query.to_lowercase();
    let root = std::path::PathBuf::from(dir);
    std::fs::read_dir(&root).map_err(|e| format!("Could not read {dir}: {e}"))?;
    let mut visited = 0usize;
    let mut found: Vec<(usize, FileEntry)> = Vec::new();
    let mut pending = vec![(root, 0usize)];
    while let Some((folder, depth)) = pending.pop() {
        let Ok(read) = std::fs::read_dir(&folder) else { continue };
        for e in read.filter_map(Result::ok) {
            visited += 1;
            if visited > max_visited {
                pending.clear();
                break;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = e.file_type() else { continue };
            if kind.is_dir() {
                if depth + 1 < SEARCH_MAX_DEPTH {
                    pending.push((e.path(), depth + 1));
                }
                continue;
            }
            if !has_extension(&name, &["ifcx"]) || !name.to_lowercase().contains(&q) {
                continue;
            }
            let mtime = e.metadata().ok().as_ref().map_or(0, modified_ms);
            found.push((depth, FileEntry { name, path: e.path().to_string_lossy().into_owned(), is_dir: false, mtime, size: 0 }));
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.name.to_lowercase().cmp(&b.1.name.to_lowercase())));
    Ok(found.into_iter().take(limit).map(|(_, e)| e).collect())
}

/// Searches the library (see `search_library_in`) off the main thread: it walks the disk and the window
/// must not freeze meanwhile.
#[tauri::command]
pub async fn search_library(scope: State<'_, FsScope>, dir: String, query: String, limit: usize) -> Result<Vec<FileEntry>, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&dir)?;
        search_library_in(&dir, &query, limit, SEARCH_MAX_VISITED)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dream_bim_library_{}_{}", std::process::id(), name))
    }

    fn temp_file(name: &str, contents: &str) -> PathBuf {
        let path = temp_path(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn path_exists_tells_them_apart() {
        let path = temp_file("exists.txt", "x");
        let there = exists(&path.to_string_lossy());
        std::fs::remove_file(&path).ok();
        assert!(there);
        let missing = std::env::temp_dir().join("dream_bim_never_exists.txt");
        assert!(!exists(&missing.to_string_lossy()));
    }

    #[test]
    fn list_library_folders_first_and_only_ifcx() {
        let dir = temp_path("library");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("Furniture")).unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        for n in ["b.ifcx", "A.IFCX", "note.txt", ".x.ifcx"] {
            std::fs::write(dir.join(n), "x").unwrap();
        }
        let r = library_listing(&dir.to_string_lossy()).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        let names: Vec<(&str, bool)> = r.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
        assert_eq!(names, vec![("Furniture", true), ("A.IFCX", false), ("b.ifcx", false)]);
    }

    #[test]
    fn list_library_gives_the_modification_time() {
        let dir = temp_path("library_mtime");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.ifcx"), "x").unwrap();
        let r = library_listing(&dir.to_string_lossy()).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
        let now = u64::try_from(now).unwrap();
        assert!(r[0].mtime > 0 && now.abs_diff(r[0].mtime) < 60_000, "unexpected mtime: {}", r[0].mtime);
    }

    #[test]
    fn search_library_is_recursive_and_limited() {
        let dir = temp_path("search_lib");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("a").join("b")).unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        std::fs::write(dir.join("a").join("chair.ifcx"), "x").unwrap();
        std::fs::write(dir.join("a").join("b").join("Red Chair.ifcx"), "x").unwrap();
        std::fs::write(dir.join(".hidden").join("chair.ifcx"), "x").unwrap();
        std::fs::write(dir.join("table.ifcx"), "x").unwrap();
        std::fs::write(dir.join("chair.txt"), "x").unwrap();
        let d = dir.to_string_lossy().into_owned();
        let all = search_library_in(&d, "CHAIR", 10, 1000).unwrap();
        let one = search_library_in(&d, "chair", 1, 1000).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        let names: Vec<&str> = all.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["chair.ifcx", "Red Chair.ifcx"]);
        assert!(all.iter().all(|e| !e.is_dir && e.mtime > 0));
        assert_eq!(one.len(), 1);
    }

    #[test]
    fn file_mtime_gives_the_date_or_none() {
        let path = temp_file("mtime.ifcx", "x");
        let ms = mtime(&path.to_string_lossy());
        std::fs::remove_file(&path).ok();
        assert!(ms.is_some_and(|m| m > 0));
        assert_eq!(mtime(&temp_path("missing_mtime.ifcx").to_string_lossy()), None);
    }

    #[test]
    fn search_library_stops_looking_at_the_entry_cap() {
        let dir = temp_path("search_cap");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..20 {
            std::fs::write(dir.join(format!("chair{i}.ifcx")), "x").unwrap();
        }
        let r = search_library_in(&dir.to_string_lossy(), "chair", 100, 5).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        assert!(r.len() <= 5, "looked at more entries than the cap: {}", r.len());
        assert!(!r.is_empty());
    }

    #[test]
    fn search_library_error_is_english() {
        match search_library_in(&temp_path("missing_search").to_string_lossy(), "x", 5, 1000) {
            Err(e) => assert!(e.starts_with("Could not read"), "unexpected message: {e}"),
            Ok(_) => panic!("an error was expected"),
        }
    }

    #[test]
    fn list_library_error_is_english() {
        match library_listing(&temp_path("missing_lib").to_string_lossy()) {
            Err(e) => assert!(e.starts_with("Could not read"), "unexpected message: {e}"),
            Ok(_) => panic!("an error was expected"),
        }
    }

    #[test]
    fn list_folder_gives_folders_and_files_of_any_type_without_hidden_ones() {
        let dir = temp_path("list_folder");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("Plans")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        for n in ["b.pdf", "A.DWG", ".hidden.txt"] {
            std::fs::write(dir.join(n), "x").unwrap();
        }
        let r = folder_listing(&dir.to_string_lossy()).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        let names: Vec<(&str, bool)> = r.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
        assert_eq!(names, vec![("Plans", true), ("A.DWG", false), ("b.pdf", false)]);
        assert_eq!(r.iter().map(|e| e.size).collect::<Vec<_>>(), vec![0, 1, 1]); // the test files weigh 1 byte
    }
}
