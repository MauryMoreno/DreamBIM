//! Documents of the project folder that the Docs screen stores, creates and opens.

use tauri::State;

use crate::fs::{blocking, extensions::has_extension, scope::FsScope};

const OUTSIDE_PROJECT_ERROR: &str = "Files can only be written inside the project folder";

/// The only extensions Studio opens with the system: documents, drawings, models, images, schedules and archives.
/// Anything else (programs, scripts, installers, shortcuts, unknown types) is refused: opening a document must not run
/// anything. An allowlist, because a blocklist always misses some executable type.
const OPENABLE_EXTENSIONS: &[&str] = &[
    // documents
    "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "odt", "ods", "ppt", "pptx",
    // drawings and models
    "dwg", "dxf", "dgn", "ifc", "ifcx", "rvt", "rfa", "nwd", "nwc", "skp", "3dm",
    // images
    "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "svg", "webp",
    // schedules and archives
    "mpp", "xer", "xml", "zip",
];

/// May Docs write to `dest`? No `..`, and inside the folder chosen as the project (`root`), but not the root itself.
/// This way the commands below only write in the folder the user opened in Docs.
fn is_inside_project(root: &str, dest: &str) -> bool {
    let path = std::path::Path::new(dest);
    if path.components().any(|c| c.as_os_str() == "..") {
        return false;
    }
    path.starts_with(std::path::Path::new(root)) && path != std::path::Path::new(root)
}

/// Copies a file (`src`) to `dest`, only inside the project folder and without overwriting. Creates the parent folders.
fn store(src: &str, dest: &str, root: &str) -> Result<(), String> {
    if !is_inside_project(root, dest) {
        return Err(OUTSIDE_PROJECT_ERROR.to_string());
    }
    let path = std::path::Path::new(dest);
    if path.exists() {
        return Err("A file with that name is already stored".to_string());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not save {dest}: {e}"))?;
    }
    std::fs::copy(src, dest).map_err(|e| format!("Could not save {dest}: {e}"))?;
    Ok(())
}

/// Creates a new folder inside the project folder; fails if it already exists.
fn make_folder(path: &str, root: &str) -> Result<(), String> {
    if !is_inside_project(root, path) {
        return Err(OUTSIDE_PROJECT_ERROR.to_string());
    }
    if std::path::Path::new(path).exists() {
        return Err("A folder or file with that name already exists".to_string());
    }
    std::fs::create_dir_all(path).map_err(|e| format!("Could not create {path}: {e}"))
}

/// May `path` be opened with the default application? It must be an existing file and not a program or script.
fn validate_open(path: &str) -> Result<(), String> {
    if !std::path::Path::new(path).is_file() {
        return Err(format!("{path} does not exist"));
    }
    if !has_extension(path, OPENABLE_EXTENSIONS) {
        return Err("For safety, Studio does not open programs or scripts".to_string());
    }
    Ok(())
}

/// Opens a document with the system's default application (Word, Excel, a DWG viewer...).
fn open(path: &str) -> Result<(), String> {
    validate_open(path)?;
    let mut command = if cfg!(target_os = "windows") {
        // explorer opens the file with its application without going through a shell, and wants backslashes
        let mut c = std::process::Command::new("explorer.exe");
        c.arg(path.replace('/', "\\"));
        c
    } else if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(path);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(path);
        c
    };
    command.spawn().map(|_| ()).map_err(|e| format!("Could not open {path}: {e}"))
}

#[tauri::command]
pub async fn store_document(scope: State<'_, FsScope>, src: String, dest: String, root: String) -> Result<(), String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        // the root must be a folder the user opened, and the source one the user can already reach
        scope.check(&root)?;
        scope.check(&dest)?;
        scope.check(&src)?;
        store(&src, &dest, &root)
    })
    .await
}

#[tauri::command]
pub async fn make_document_folder(scope: State<'_, FsScope>, path: String, root: String) -> Result<(), String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&root)?;
        scope.check(&path)?;
        make_folder(&path, &root)
    })
    .await
}

#[tauri::command]
pub async fn open_document(scope: State<'_, FsScope>, path: String) -> Result<(), String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        scope.check(&path)?;
        open(&path)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dream_bim_docs_{}_{}", std::process::id(), name))
    }

    #[test]
    fn store_document_only_inside_the_chosen_folder_and_never_overwrites() {
        let dir = temp_path("store");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("Plans")).unwrap();
        let src = dir.join("source.pdf");
        std::fs::write(&src, [0x25u8, 0x50, 0x44, 0x46]).unwrap();
        let src_s = src.to_string_lossy().into_owned();
        let root = dir.to_string_lossy().into_owned();

        let outside = temp_path("store_outside").join("A.pdf").to_string_lossy().into_owned();
        assert_eq!(store(&src_s, &outside, &root), Err(OUTSIDE_PROJECT_ERROR.to_string()));

        let with_dots = dir.join("Plans").join("..").join("..").join("outside.pdf").to_string_lossy().into_owned();
        assert_eq!(store(&src_s, &with_dots, &root), Err(OUTSIDE_PROJECT_ERROR.to_string()));

        let dest = dir.join("Plans").join("A.pdf").to_string_lossy().into_owned();
        assert_eq!(store(&src_s, &dest, &root), Ok(()));
        assert_eq!(std::fs::read(&dest).unwrap(), vec![0x25, 0x50, 0x44, 0x46]);
        assert_eq!(store(&src_s, &dest, &root), Err("A file with that name is already stored".to_string()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn make_document_folder_only_inside_the_chosen_folder() {
        let dir = temp_path("project");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.to_string_lossy().into_owned();
        let folder = dir.join("Plans").join("Structure").to_string_lossy().into_owned();

        assert_eq!(make_folder(&folder, &root), Ok(()));
        assert!(std::path::Path::new(&folder).is_dir());
        assert!(make_folder(&folder, &root).is_err());

        let outside = temp_path("project_outside").join("New").to_string_lossy().into_owned();
        assert_eq!(make_folder(&outside, &root), Err(OUTSIDE_PROJECT_ERROR.to_string()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_document_only_opens_known_document_types() {
        let dir = temp_path("open");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("Folder")).unwrap();
        let openable = ["a.pdf", "B.DWG", "c.xlsx", "d.docx", "e.png", "f.ifc", "g.ifcx", "h.rvt"];
        let refused = ["run.exe", "x.BAT", "s.ps1", "a.py", "a.wsc", "a.application", "a.msix", "a.appx", "a.vb", "a.ws", "a.inf", "a.settingcontent-ms", "no_extension"];
        for n in openable.iter().chain(refused.iter()) {
            std::fs::write(dir.join(n), "x").unwrap();
        }
        let path = |n: &str| dir.join(n).to_string_lossy().into_owned();
        for n in openable {
            assert_eq!(validate_open(&path(n)), Ok(()), "{n}");
        }
        for n in refused {
            assert_eq!(validate_open(&path(n)), Err("For safety, Studio does not open programs or scripts".to_string()), "{n}");
        }
        assert!(validate_open(&path("missing.pdf")).unwrap_err().ends_with("does not exist"));
        assert!(validate_open(&path("Folder")).is_err()); // a folder is not a document
        std::fs::remove_dir_all(&dir).ok();
    }
}
