use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A temporary name next to `path`, unique per process and per call, so two saves never share a file.
fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{}-{}.tmp", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
    PathBuf::from(name)
}

fn write_and_swap(tmp: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::File::create(tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(tmp, path)
}

/// Writes `bytes` to `path` atomically: writes a unique temporary file, flushes it to disk and renames it
/// over `path`. The error is English text meant to be shown as is in the UI.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_path(path);
    write_and_swap(&tmp, path, bytes).map_err(|e| {
        // best-effort cleanup of the temporary file
        std::fs::remove_file(&tmp).ok();
        format!("Could not save {}: {e}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dream_bim_atomic_{}_{name}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_and_overwrites() {
        let dir = temp_dir("overwrite");
        let file = dir.join("a.ifcx");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"two");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fails_with_an_english_message_when_the_folder_is_missing() {
        let file = std::env::temp_dir().join("dream_bim_atomic_missing_dir").join("sub").join("a.ifcx");
        let error = write_atomic(&file, b"x").unwrap_err();
        assert!(error.starts_with("Could not save"), "unexpected message: {error}");
    }

    #[test]
    fn concurrent_writes_do_not_collide() {
        let dir = temp_dir("concurrent");
        let file = dir.join("shared.ifcx");
        let contents: Vec<Vec<u8>> = (0..8).map(|i| vec![b'a' + i; 50_000]).collect();
        std::thread::scope(|scope| {
            for bytes in &contents {
                let file = &file;
                scope.spawn(move || write_atomic(file, bytes).unwrap());
            }
        });
        let result = std::fs::read(&file).unwrap();
        assert!(contents.contains(&result), "the file is not one complete write");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files left behind");
        std::fs::remove_dir_all(&dir).ok();
    }
}
