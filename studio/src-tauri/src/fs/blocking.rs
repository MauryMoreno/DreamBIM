/// Runs blocking disk work off the async runtime's threads, so the window never waits for the disk.
pub async fn run<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| format!("Disk task failed: {e}"))?
}
