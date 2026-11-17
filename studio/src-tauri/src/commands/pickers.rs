//! Open, save and folder dialogs. They live in Rust, not in the webview, so that what the user picks is what
//! grants access: the disk commands only reach folders returned by these commands.

use std::path::{Path, PathBuf};

use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::fs::{blocking, scope::FsScope};

/// A file-type filter of a dialog, as the frontend sends it.
#[derive(serde::Deserialize, Debug)]
pub struct PickFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// A filter that allows every extension adds nothing to the dialog.
fn is_wildcard(filter: &PickFilter) -> bool {
    filter.extensions.iter().any(|e| e == "*")
}

/// Splits the suggested save path into the folder to start in and the file name; either may be missing.
fn split_suggestion(suggested: &str) -> (Option<PathBuf>, Option<String>) {
    let path = Path::new(suggested);
    let dir = path.parent().filter(|p| !p.as_os_str().is_empty()).map(Path::to_path_buf);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
    (dir, name)
}

fn as_text(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

/// Asks for one file and grants its folder. None when the dialog is cancelled.
#[tauri::command]
pub async fn pick_open_file(app: tauri::AppHandle, scope: State<'_, FsScope>, filters: Vec<PickFilter>) -> Result<Option<String>, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        let mut dialog = app.dialog().file();
        for filter in filters.iter().filter(|f| !is_wildcard(f)) {
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(&filter.name, &extensions);
        }
        let Some(picked) = dialog.blocking_pick_file() else { return Ok(None) };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        scope.grant_file(&path);
        Ok(Some(as_text(path)))
    })
    .await
}

/// Asks where to save and grants that folder. None when the dialog is cancelled.
#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    scope: State<'_, FsScope>,
    suggested: String,
    filters: Vec<PickFilter>,
) -> Result<Option<String>, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        let mut dialog = app.dialog().file();
        for filter in filters.iter().filter(|f| !is_wildcard(f)) {
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(&filter.name, &extensions);
        }
        let (dir, name) = split_suggestion(&suggested);
        if let Some(dir) = dir {
            dialog = dialog.set_directory(dir);
        }
        if let Some(name) = name {
            dialog = dialog.set_file_name(name);
        }
        let Some(picked) = dialog.blocking_save_file() else { return Ok(None) };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        scope.grant_file(&path);
        Ok(Some(as_text(path)))
    })
    .await
}

/// Asks for a folder and grants it with everything inside. None when the dialog is cancelled.
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle, scope: State<'_, FsScope>) -> Result<Option<String>, String> {
    let scope = scope.inner().clone();
    blocking::run(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        scope.grant_folder(&path);
        Ok(Some(as_text(path)))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_suggested_path_gives_folder_and_name() {
        let (dir, name) = split_suggestion("C:/Work/House.ifcx");
        assert_eq!(name.as_deref(), Some("House.ifcx"));
        assert_eq!(dir, Some(PathBuf::from("C:/Work")));
    }

    #[test]
    fn a_bare_name_has_no_folder() {
        let (dir, name) = split_suggestion("House.ifcx");
        assert_eq!(dir, None);
        assert_eq!(name.as_deref(), Some("House.ifcx"));
    }

    #[test]
    fn only_the_all_files_filter_is_a_wildcard() {
        let all = PickFilter { name: "All files".to_string(), extensions: vec!["*".to_string()] };
        let model = PickFilter { name: "IFCx Model".to_string(), extensions: vec!["ifcx".to_string()] };
        assert!(is_wildcard(&all));
        assert!(!is_wildcard(&model));
    }

    #[test]
    fn filters_deserialize_from_the_frontend_shape() {
        let filter: PickFilter = serde_json::from_str(r#"{"name":"IFCx Model","extensions":["ifcx"]}"#).unwrap();
        assert_eq!(filter.extensions, vec!["ifcx"]);
    }
}
