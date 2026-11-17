// Supervisor of the stdio bridge of the shared agent (chatbot-revit/AI_Manage).
// Reduced port of `PyProcState` from chatbot-revit/frontend/src-tauri/src/main.rs: ONE single reader of
// stdout hands every NDJSON event to whoever waits for its `id`, so two commands do not fight over
// the `read_line` lines.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, Mutex};

use super::layout::{self, ProcSpec};
use super::watchdog::BRIDGE_LOG_MAX_BYTES;

/// File where the bridge's stderr goes; the error view points to it.
pub const BRIDGE_LOG: &str = "ifcx_assistant_bridge.log";
/// Python takes a while to import before reading its first line: a generous margin for `set_workspace`.
const WORKSPACE_TIMEOUT: Duration = Duration::from_secs(60);

pub enum Route {
    Sub,
    Push(String),
    Drop,
}

/// Where a bridge event goes: to the subscriber of its `id`; if there is none, to push if it declares so
/// (background sub-agents); otherwise it is dropped (e.g. the `ack` of a `tool_confirm`).
pub fn route(val: &Value, has_sub: bool) -> Route {
    if has_sub {
        return Route::Sub;
    }
    if val.get("push").and_then(Value::as_bool).unwrap_or(false) {
        let ev = val.get("event").and_then(Value::as_str).unwrap_or("").to_string();
        if !ev.is_empty() {
            return Route::Push(ev);
        }
    }
    Route::Drop
}

static REQ_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Unique id for requests generated in Rust (two in the same millisecond do not collide).
pub fn next_request_id() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
    format!("{ms}-{}", REQ_COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn log_path() -> PathBuf {
    std::env::temp_dir().join(BRIDGE_LOG)
}

/// Opens the log for appending. A log over `max_bytes` is first moved to `<log>.1` (replacing an older one), so
/// it never grows without limit.
fn open_log(path: &Path, max_bytes: u64) -> std::io::Result<std::fs::File> {
    if std::fs::metadata(path).is_ok_and(|m| m.len() > max_bytes) {
        let mut rotated = path.as_os_str().to_owned();
        rotated.push(".1");
        std::fs::rename(path, rotated)?;
    }
    std::fs::OpenOptions::new().create(true).append(true).open(path)
}

struct Proc {
    child: Child,
    stdin: ChildStdin,
}

/// Emits an event to the window. It is a closure and not an `AppHandle` so the rest of the bridge (and its
/// tests) does not drag in the Tauri runtime: the test binary does not start on Windows without its manifest.
type Emit = Box<dyn Fn(&str, &Value) + Send + Sync>;

pub struct Bridge {
    proc: Mutex<Option<Proc>>,
    /// Prevents two launches at once (two commands arriving together when the panel opens).
    starting: Mutex<()>,
    running: AtomicBool,
    /// Goes up on every launch: the EOF of a bridge replaced on purpose must not close the new one.
    generation: AtomicU64,
    last_error: std::sync::Mutex<Option<String>>,
    project: std::sync::Mutex<Option<PathBuf>>,
    subs: Mutex<HashMap<String, mpsc::UnboundedSender<Value>>>,
    emit: OnceLock<Emit>,
}

impl Bridge {
    pub fn new() -> Arc<Self> {
        Arc::new(Bridge {
            proc: Mutex::new(None),
            starting: Mutex::new(()),
            running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            last_error: std::sync::Mutex::new(None),
            project: std::sync::Mutex::new(None),
            subs: Mutex::new(HashMap::new()),
            emit: OnceLock::new(),
        })
    }

    /// Keeps the AppHandle to emit events to the window (once, in `setup`).
    pub fn set_app(&self, app: AppHandle) {
        self.set_emitter(Box::new(move |name, payload| {
            let _ = app.emit(name, payload);
        }));
    }

    /// Sets how events are emitted (in the app, to the window; in tests, to a log).
    pub fn set_emitter(&self, emit: Emit) {
        let _ = self.emit.set(emit);
    }

    /// JSON for the error view: whether it runs, why not, where the log is and the project folder.
    pub fn status(&self) -> Value {
        let error = self.last_error.lock().ok().and_then(|e| e.clone());
        let project = self
            .project
            .lock()
            .ok()
            .and_then(|p| p.clone())
            .or_else(|| layout::detect().ok().map(|(_, p)| p))
            .map(|p| p.display().to_string());
        json!({
            "running": self.running.load(Ordering::SeqCst),
            "error": error,
            "log": log_path().display().to_string(),
            "projectDir": project,
        })
    }

    /// The status in the shape BuiltBot expects (`bridge_status` and `bridge://error`): whether it runs, why
    /// not and where the log is.
    pub fn builtbot_status(&self) -> Value {
        let s = self.status();
        // with an error it is not running as far as BuiltBot is concerned, even if the process lives (e.g. set_workspace failed)
        let running = s["running"].as_bool().unwrap_or(false) && s["error"].is_null();
        json!({ "running": running, "error": s["error"], "log": s["log"] })
    }

    /// Records why the bridge is unusable and tells the window.
    fn fail(&self, msg: String) {
        if let Ok(mut e) = self.last_error.lock() {
            *e = Some(msg);
        }
        if let Some(emit) = self.emit.get() {
            emit("bridge://error", &self.builtbot_status());
        }
    }

    /// Launches the bridge if it is not running. If it runs but is left with an error (e.g. `set_workspace` failed),
    /// it returns it so the panel offers Retry instead of letting the user chat without a project folder.
    pub async fn ensure_started(self: &Arc<Self>) -> Result<(), String> {
        let _guard = self.starting.lock().await;
        if self.proc.lock().await.is_some() {
            return match self.last_error.lock().ok().and_then(|e| e.clone()) {
                Some(e) => Err(e),
                None => Ok(()),
            };
        }
        self.start().await
    }

    /// Stops the bridge for good (the app is exiting): kills the process and wakes whoever waits.
    pub async fn shutdown(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(mut old) = self.proc.lock().await.take() {
            let _ = old.child.kill().await;
        }
        self.running.store(false, Ordering::SeqCst);
        self.close_all_subs().await;
    }

    /// Replaces the running bridge (e.g. after changing the `.env`, which is only read on import).
    pub async fn restart(self: &Arc<Self>) -> Result<(), String> {
        let _guard = self.starting.lock().await;
        self.generation.fetch_add(1, Ordering::SeqCst); // the EOF of the old reader no longer counts
        if let Some(mut old) = self.proc.lock().await.take() {
            let _ = old.child.kill().await;
        }
        self.running.store(false, Ordering::SeqCst);
        self.close_all_subs().await;
        self.start().await
    }

    async fn start(self: &Arc<Self>) -> Result<(), String> {
        let (spec, project) = layout::detect().inspect_err(|e| self.fail(e.clone()))?;
        self.launch(spec, project).await
    }

    async fn launch(self: &Arc<Self>, spec: ProcSpec, project: PathBuf) -> Result<(), String> {
        let spawned = (|| -> Result<_, String> {
            spec.check()?;
            let mut cmd = spec.std_command();
            cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
            let log = log_path();
            let f = open_log(&log, BRIDGE_LOG_MAX_BYTES).map_err(|e| format!("Could not open {}: {e}", log.display()))?;
            cmd.stderr(f);
            let mut cmd = tokio::process::Command::from(cmd);
            cmd.kill_on_drop(true);
            let mut child =
                cmd.spawn().map_err(|e| format!("Could not start {}: {e}", spec.program.display()))?;
            let stdin = child.stdin.take().ok_or("no stdin")?;
            let stdout = child.stdout.take().ok_or("no stdout")?;
            Ok((child, stdin, stdout))
        })();
        let (child, stdin, stdout) = match spawned {
            Ok(x) => x,
            Err(e) => {
                self.fail(e.clone());
                return Err(e);
            }
        };
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.proc.lock().await = Some(Proc { child, stdin });
        self.running.store(true, Ordering::SeqCst);
        if let Ok(mut e) = self.last_error.lock() {
            *e = None;
        }
        if let Ok(mut p) = self.project.lock() {
            *p = Some(project.clone());
        }

        // The only stdout reader: hands every event to its subscriber.
        let reader = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match lines.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => reader.dispatch_line(&line).await,
                }
            }
            if reader.generation.load(Ordering::SeqCst) != generation {
                return; // replaced on purpose
            }
            *reader.proc.lock().await = None;
            reader.running.store(false, Ordering::SeqCst);
            reader.close_all_subs().await; // wakes the commands that are waiting
            reader.fail("The assistant process exited".to_string());
        });

        self.set_workspace(&project).await
    }

    /// Tells the agent which folder it works in and waits for it to confirm.
    async fn set_workspace(&self, project: &Path) -> Result<(), String> {
        let rid = next_request_id();
        let mut rx = self.subscribe(&rid).await;
        let req = json!({"id": rid, "type": "set_workspace", "path": project.display().to_string()});
        if let Err(e) = self.write(&req).await {
            self.unsubscribe(&rid).await;
            self.fail(e.clone());
            return Err(e);
        }
        let waited = tokio::time::timeout(WORKSPACE_TIMEOUT, async {
            let mut error = None;
            loop {
                let Some(v) = rx.recv().await else {
                    return Err("The assistant process exited".to_string());
                };
                match v.get("event").and_then(Value::as_str) {
                    Some("error") => {
                        error = Some(v.get("message").and_then(Value::as_str).unwrap_or("error").to_string());
                    }
                    Some("end") => return error.map_or(Ok(()), Err),
                    _ => {}
                }
            }
        })
        .await;
        self.unsubscribe(&rid).await;
        let result = waited.unwrap_or_else(|_| Err("The assistant did not answer in time".to_string()));
        if let Err(e) = &result {
            self.fail(e.clone());
        }
        result
    }

    /// Writes a JSON line to the bridge's stdin.
    pub async fn write(&self, req: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(req).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut guard = self.proc.lock().await;
        let Some(p) = guard.as_mut() else {
            return Err(self
                .last_error
                .lock()
                .ok()
                .and_then(|e| e.clone())
                .unwrap_or_else(|| "The assistant process is not running".to_string()));
        };
        p.stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
        p.stdin.flush().await.map_err(|e| e.to_string())
    }

    /// Channel that receives every event with that `rid`.
    pub async fn subscribe(&self, rid: &str) -> mpsc::UnboundedReceiver<Value> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.subs.lock().await.insert(rid.to_string(), tx);
        rx
    }

    pub async fn unsubscribe(&self, rid: &str) {
        self.subs.lock().await.remove(rid);
    }

    /// Dead bridge: those waiting receive `None`.
    async fn close_all_subs(&self) {
        self.subs.lock().await.clear();
    }

    /// Parses a line from the bridge and hands it to its subscriber (or to push).
    pub async fn dispatch_line(&self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let rid = val.get("id").and_then(Value::as_str).unwrap_or("");
        let subs = self.subs.lock().await;
        match route(&val, subs.contains_key(rid)) {
            Route::Sub => {
                if let Some(tx) = subs.get(rid) {
                    let _ = tx.send(val.clone());
                }
            }
            Route::Push(ev) => {
                if let Some(emit) = self.emit.get() {
                    emit(&format!("push://{ev}"), &val);
                }
            }
            Route::Drop => {}
        }
    }
}

#[cfg(test)]
mod tests;
