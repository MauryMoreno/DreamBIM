use std::fs::Metadata;
use std::time::UNIX_EPOCH;

/// A folder or a file in a listing. Serialized with camelCase names, as the frontend expects.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// Last modification, in ms since the Unix epoch (0 when the system does not give it).
    pub mtime: u64,
    /// Size in bytes (0 for folders and where it is not requested).
    pub size: u64,
}

/// Last modification in ms since the Unix epoch, or None when the system does not give it.
pub fn modified_ms_opt(meta: &Metadata) -> Option<u64> {
    let since_epoch = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(u64::try_from(since_epoch.as_millis()).unwrap_or(u64::MAX))
}

/// Like `modified_ms_opt`, with 0 when unknown.
pub fn modified_ms(meta: &Metadata) -> u64 {
    modified_ms_opt(meta).unwrap_or(0)
}

/// Folders first, then by name ignoring case.
pub fn sort_dirs_first(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
}

/// Lists a folder without hidden entries. `keep(name, is_dir)` filters; `with_size` fills the size of files.
/// Errors are English text meant to be shown as is.
pub fn list_entries(dir: &str, keep: impl Fn(&str, bool) -> bool, with_size: bool) -> Result<Vec<FileEntry>, String> {
    let read = std::fs::read_dir(dir).map_err(|e| format!("Could not read {dir}: {e}"))?;
    let mut out: Vec<FileEntry> = read
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let is_dir = e.file_type().ok()?.is_dir();
            if !keep(&name, is_dir) {
                return None;
            }
            let meta = e.metadata().ok();
            let mtime = meta.as_ref().map_or(0, modified_ms);
            let size = if with_size && !is_dir { meta.map_or(0, |m| m.len()) } else { 0 };
            Some(FileEntry { name, path: e.path().to_string_lossy().into_owned(), is_dir, mtime, size })
        })
        .collect();
    sort_dirs_first(&mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, is_dir: bool) -> FileEntry {
        FileEntry { name: name.to_string(), path: name.to_string(), is_dir, mtime: 0, size: 0 }
    }

    #[test]
    fn folders_first_then_by_name_ignoring_case() {
        let mut v = vec![entry("b.ifcx", false), entry("A.IFCX", false), entry("Zeta", true), entry("alpha", true)];
        sort_dirs_first(&mut v);
        let names: Vec<&str> = v.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Zeta", "A.IFCX", "b.ifcx"]);
    }

    #[test]
    fn serializes_with_camel_case_names() {
        let json = serde_json::to_value(entry("a", true)).unwrap();
        assert_eq!(json["isDir"], true);
        assert!(json.get("is_dir").is_none());
    }
}
