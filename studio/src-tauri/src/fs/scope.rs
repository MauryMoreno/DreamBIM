//! The folders the disk commands may touch: only those the user picked (a folder, or the folder of a file).
//! Grants are persisted, so a recent file from a previous session still opens.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const OUTSIDE_SCOPE_ERROR: &str = "That file is outside the folders opened in Dream BIM";

/// Setting this variable to `1` disables the scope (an escape hatch for projects whose files live in sibling
/// folders that were never picked).
const UNRESTRICTED_VARIABLE: &str = "DREAM_BIM_UNRESTRICTED_FS";

struct Inner {
    roots: Mutex<BTreeSet<PathBuf>>,
    store: Option<PathBuf>,
    unrestricted: bool,
}

/// Shared, cheap to clone: every command holds the same set of granted folders.
#[derive(Clone)]
pub struct FsScope {
    inner: Arc<Inner>,
}

impl FsScope {
    /// Loads the persisted grants from `store_path` (none when it does not exist or is unreadable).
    pub fn load(store_path: &Path) -> FsScope {
        let roots = std::fs::read_to_string(store_path)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .collect();
        let unrestricted = std::env::var(UNRESTRICTED_VARIABLE).is_ok_and(|v| v == "1");
        FsScope { inner: Arc::new(Inner { roots: Mutex::new(roots), store: Some(store_path.to_path_buf()), unrestricted }) }
    }

    /// Grants a folder and everything inside it.
    pub fn grant_folder(&self, dir: &Path) {
        let Ok(canonical) = dir.canonicalize() else { return };
        let snapshot = {
            let mut roots = self.inner.roots.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if !roots.insert(canonical) {
                return;
            }
            roots.iter().map(|r| r.to_string_lossy().into_owned()).collect::<Vec<_>>()
        };
        self.persist(&snapshot);
    }

    /// Grants the folder of a file (the file itself may not exist yet, as in Save As).
    pub fn grant_file(&self, file: &Path) {
        if let Some(parent) = file.parent() {
            self.grant_folder(parent);
        }
    }

    /// Resolves `path` and checks it lies inside a granted folder. The path may not exist yet (a file about to be
    /// written); `..` is always refused.
    pub fn check(&self, path: &str) -> Result<PathBuf, String> {
        if self.inner.unrestricted {
            return Ok(PathBuf::from(path));
        }
        let resolved = resolve(Path::new(path)).ok_or_else(|| OUTSIDE_SCOPE_ERROR.to_string())?;
        let roots = self.inner.roots.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if roots.iter().any(|root| resolved.starts_with(root)) {
            Ok(resolved)
        } else {
            Err(OUTSIDE_SCOPE_ERROR.to_string())
        }
    }

    fn persist(&self, roots: &[String]) {
        let Some(store) = &self.inner.store else { return };
        if let Ok(json) = serde_json::to_string_pretty(roots) {
            if let Some(parent) = store.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            // best effort: a failed write only means the grants are forgotten at the next start
            crate::fs::atomic::write_atomic(store, json.as_bytes()).ok();
        }
    }
}

/// The path with symlinks resolved. The part that does not exist yet is appended as is: the nearest existing
/// ancestor is the one that is resolved. `..` makes it fail.
fn resolve(path: &Path) -> Option<PathBuf> {
    if path.components().any(|c| c == Component::ParentDir) {
        return None;
    }
    let mut existing = path;
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        if let Ok(mut resolved) = existing.canonicalize() {
            resolved.extend(tail.iter().rev());
            return Some(resolved);
        }
        tail.push(existing.file_name()?);
        existing = existing.parent()?;
    }
}

/// The folders of the recent files stored by the frontend (`{"recents": [{"path": ...}]}`), without duplicates.
/// Both `\` and `/` separate folders: the paths come from Windows whichever platform parses them.
pub fn recent_folders(store_json: &str) -> Vec<PathBuf> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(store_json) else { return Vec::new() };
    let mut folders: Vec<PathBuf> = Vec::new();
    for entry in value.get("recents").and_then(|r| r.as_array()).into_iter().flatten() {
        let Some(path) = entry.get("path").and_then(|p| p.as_str()) else { continue };
        let Some(cut) = path.rfind(['/', '\\']) else { continue };
        let folder = PathBuf::from(&path[..cut]);
        if !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    folders
}

/// The scope of this run: the persisted grants of `<data_dir>/scope.json`, plus `always` (folders the app itself works
/// in, such as the Assistant project). On the very first run after the update, the folders of the recent files kept by
/// the previous version (`<data_dir>/recents.json`) are granted so they still open.
pub fn init(data_dir: &Path, always: &[PathBuf]) -> FsScope {
    let store = data_dir.join("scope.json");
    let first_run = !store.exists();
    let scope = FsScope::load(&store);
    if first_run && let Ok(json) = std::fs::read_to_string(data_dir.join("recents.json")) {
        for folder in recent_folders(&json) {
            scope.grant_folder(&folder);
        }
    }
    for folder in always {
        scope.grant_folder(folder);
    }
    scope
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dream_bim_scope_{}_{name}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn scope_in(dir: &Path) -> FsScope {
        FsScope::load(&dir.join("scope.json"))
    }

    fn text(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn granting_a_file_grants_its_folder() {
        let dir = temp_dir("file");
        let project = dir.join("p");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("model.ifcx"), "x").unwrap();
        let scope = scope_in(&dir);
        scope.grant_file(&project.join("model.ifcx"));
        assert!(scope.check(&text(&project.join("model.costs.ifcx"))).is_ok());
        assert!(scope.check(&text(&project.join("model.ifcx"))).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_outside_and_traversal() {
        let dir = temp_dir("outside");
        let project = dir.join("p");
        let other = dir.join("other");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let scope = scope_in(&dir);
        scope.grant_folder(&project);
        assert_eq!(scope.check(&text(&other.join("x.ifcx"))), Err(OUTSIDE_SCOPE_ERROR.to_string()));
        assert_eq!(scope.check(&text(&project.join("..").join("other").join("x.ifcx"))), Err(OUTSIDE_SCOPE_ERROR.to_string()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let dir = temp_dir("symlink");
        let project = dir.join("p");
        let other = dir.join("other");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::os::unix::fs::symlink(&other, project.join("link")).unwrap();
        let scope = scope_in(&dir);
        scope.grant_folder(&project);
        assert!(scope.check(&text(&project.join("link").join("x.ifcx"))).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scope_survives_restart() {
        let dir = temp_dir("restart");
        let project = dir.join("p");
        std::fs::create_dir_all(&project).unwrap();
        scope_in(&dir).grant_folder(&project);
        let reloaded = scope_in(&dir);
        assert!(reloaded.check(&text(&project.join("a.ifcx"))).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn subfolders_are_in_scope() {
        let dir = temp_dir("sub");
        let project = dir.join("p");
        std::fs::create_dir_all(project.join("a").join("b")).unwrap();
        let scope = scope_in(&dir);
        scope.grant_folder(&project);
        assert!(scope.check(&text(&project.join("a").join("b").join("c.ifcx"))).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_that_does_not_exist_yet_is_in_scope_when_its_folder_is() {
        let dir = temp_dir("new_file");
        let project = dir.join("p");
        std::fs::create_dir_all(&project).unwrap();
        let scope = scope_in(&dir);
        scope.grant_folder(&project);
        assert!(scope.check(&text(&project.join("new").join("deep").join("model.ifcx"))).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_is_in_scope_before_any_grant() {
        let dir = temp_dir("empty");
        assert!(scope_in(&dir).check(&text(&dir.join("a.ifcx"))).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn first_run_grants_existing_recents() {
        let json = r#"{"recents":[
            {"name":"a.ifcx","path":"C:\\Work\\One\\a.ifcx","openedAt":1,"thumbnail":null},
            {"name":"b.ifcx","path":"C:\\Work\\One\\b.ifcx","openedAt":2,"thumbnail":null},
            {"name":"c.ifcx","path":"D:/Other/c.ifcx","openedAt":3,"thumbnail":null}]}"#;
        let folders = recent_folders(json);
        assert_eq!(folders.len(), 2);
        assert!(folders.contains(&PathBuf::from("C:\\Work\\One")) || folders.contains(&PathBuf::from("C:/Work/One")) || folders.iter().any(|f| f.ends_with("One")));
        assert!(recent_folders("not json").is_empty());
        assert!(recent_folders(r#"{"recents": 3}"#).is_empty());
    }

    #[test]
    fn init_grants_the_recents_of_the_previous_version_only_on_the_first_run() {
        let dir = temp_dir("init");
        let old_project = dir.join("old");
        let new_project = dir.join("new");
        let extra = dir.join("assistant");
        for p in [&old_project, &new_project, &extra] {
            std::fs::create_dir_all(p).unwrap();
        }
        let recents = |p: &Path| format!(r#"{{"recents":[{{"path":{:?}}}]}}"#, p.join("a.ifcx").to_string_lossy());
        std::fs::write(dir.join("recents.json"), recents(&old_project)).unwrap();

        let first = init(&dir, std::slice::from_ref(&extra));
        assert!(first.check(&text(&old_project.join("a.ifcx"))).is_ok(), "recent of the previous version");
        assert!(first.check(&text(&extra.join("x.ifcx"))).is_ok(), "extra folder");

        std::fs::write(dir.join("recents.json"), recents(&new_project)).unwrap();
        let second = init(&dir, &[extra]);
        assert!(second.check(&text(&old_project.join("a.ifcx"))).is_ok(), "the grant persisted");
        assert!(second.check(&text(&new_project.join("a.ifcx"))).is_err(), "later recents are not granted again");
        std::fs::remove_dir_all(&dir).ok();
    }
}
