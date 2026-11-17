// BuiltBot commands over the Assistant bridge. Same names, arguments and events as
// chatbot-revit/frontend/src-tauri/src/main.rs: this way the BuiltBot interface works inside Studio without
// changing its code. Specific to Studio: `studio_result` and the studio://turn-start / turn-end notices.
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{Emitter, State, Window};

use tokio::sync::mpsc::UnboundedReceiver;

use super::bridge::{next_request_id, Bridge};
use super::watchdog::{recv_or_idle, REQUEST_TIMEOUT, TURN_IDLE_TIMEOUT};

/// Makes sure the request carries an `id` (keeps the one it has; if missing or empty, generates a unique one).
pub fn with_id(mut payload: Value) -> (Value, String) {
    let id = payload
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map_or_else(next_request_id, str::to_string);
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("id".into(), Value::String(id.clone()));
    }
    (payload, id)
}

/// Inside Studio the agent's folder is always the project's (`proyecto/`): the CDE skill, the
/// «Undo turn» journal and the rule of not writing .ifcx by hand all depend on it.
pub fn refuses_workspace(payload: &Value) -> Option<&'static str> {
    match payload.get("type").and_then(Value::as_str) {
        Some("set_workspace" | "clear_workspace") => Some("The project folder is fixed inside Dream BIM"),
        _ => None,
    }
}

/// Guard common to everything the window writes to the bridge: the bridge dispatches by `type`, whichever
/// command it comes through.
pub fn check_payload(payload: &Value) -> Result<(), String> {
    match refuses_workspace(payload) {
        Some(reason) => Err(reason.to_string()),
        None => Ok(()),
    }
}

/// Tells the Studio window that a turn starts and, when dropped (by any exit path,
/// including an error or a cancellation), that it ends: this way the edit lock is never left on.
pub struct TurnGuard<F: Fn(&str, &Value)> {
    id: String,
    emit: F,
}

impl<F: Fn(&str, &Value)> TurnGuard<F> {
    pub fn new(id: &str, emit: F) -> Self {
        emit("studio://turn-start", &json!({ "id": id }));
        TurnGuard { id: id.to_string(), emit }
    }
}

impl<F: Fn(&str, &Value)> Drop for TurnGuard<F> {
    fn drop(&mut self) {
        (self.emit)("studio://turn-end", &json!({ "id": self.id }));
    }
}

/// Why a stream of bridge events ended.
enum PumpEnd {
    /// The `end` event arrived.
    Done,
    /// The bridge closed the channel (it exited).
    Closed,
    /// Nothing arrived for the idle limit: the bridge is hung.
    Stalled,
    /// The window could not be told.
    EmitFailed(String),
}

const STALLED_ERROR: &str = "The assistant stopped responding";

/// Hands the `events` of a request to `emit` until `end`, giving up when the bridge stays silent for `idle`.
async fn pump(
    rx: &mut UnboundedReceiver<Value>,
    idle: Duration,
    events: &[&str],
    mut emit: impl FnMut(&str, &Value) -> Result<(), String>,
) -> PumpEnd {
    loop {
        let val = match recv_or_idle(rx, idle).await {
            Ok(Some(val)) => val,
            Ok(None) => return PumpEnd::Closed,
            Err(_) => return PumpEnd::Stalled,
        };
        let ev = val.get("event").and_then(Value::as_str).unwrap_or("").to_string();
        if events.contains(&ev.as_str()) && let Err(e) = emit(&ev, &val) {
            return PumpEnd::EmitFailed(e);
        }
        if ev == "end" {
            return PumpEnd::Done;
        }
    }
}

/// Tells the bridge to stop a request it no longer answers.
async fn cancel_stalled(bridge: &Arc<Bridge>, id: &str) {
    let _ = bridge.write(&json!({ "id": id, "type": "cancel" })).await;
}

/// Writes the request and forwards as `chat://<event>` the `events` of that id until `end`.
async fn forward(bridge: &Arc<Bridge>, window: &Window, payload: Value, events: &[&str]) -> Result<(), String> {
    check_payload(&payload)?;
    bridge.ensure_started().await?;
    let (req, id) = with_id(payload);
    let mut rx = bridge.subscribe(&id).await;
    if let Err(e) = bridge.write(&req).await {
        bridge.unsubscribe(&id).await;
        return Err(e);
    }
    let end = pump(&mut rx, TURN_IDLE_TIMEOUT, events, |ev, val| {
        window.emit(&format!("chat://{ev}"), val).map_err(|e| e.to_string())
    })
    .await;
    let result = match end {
        PumpEnd::Done => Ok(()),
        PumpEnd::Closed => Err("bridge closed (EOF)".to_string()),
        PumpEnd::Stalled => {
            cancel_stalled(bridge, &id).await;
            Err(STALLED_ERROR.to_string())
        }
        PumpEnd::EmitFailed(e) => Err(e),
    };
    bridge.unsubscribe(&id).await;
    result
}

/// A chat turn. It also forwards `studio_call`, which the Studio window answers.
#[tauri::command]
pub async fn chat_stream(bridge: State<'_, Arc<Bridge>>, window: Window, payload: Value) -> Result<(), String> {
    let id = payload.get("id").and_then(Value::as_str).unwrap_or("unknown").to_string();
    let w = window.clone();
    let _turn = TurnGuard::new(&id, move |name, v| {
        let _ = w.emit(name, v);
    });
    forward(
        &bridge,
        &window,
        payload,
        &["start", "delta", "tool", "ask", "thinking", "usage", "heartbeat", "studio_call", "end", "error"],
    )
    .await
}

#[tauri::command]
pub async fn send_request(bridge: State<'_, Arc<Bridge>>, window: Window, payload: Value) -> Result<(), String> {
    forward(&bridge, &window, payload, &["start", "tool", "delta", "end", "error"]).await
}

/// Request with an answer: returns the last data event before `end` (or null).
#[tauri::command]
pub async fn conv_request(bridge: State<'_, Arc<Bridge>>, payload: Value) -> Result<Value, String> {
    check_payload(&payload)?;
    bridge.ensure_started().await?;
    let (req, id) = with_id(payload);
    let mut rx = bridge.subscribe(&id).await;
    if let Err(e) = bridge.write(&req).await {
        bridge.unsubscribe(&id).await;
        return Err(e);
    }
    let mut captured = Value::Null;
    let result = loop {
        let val = match recv_or_idle(&mut rx, REQUEST_TIMEOUT).await {
            Ok(Some(val)) => val,
            Ok(None) => break Err("bridge closed (EOF)".to_string()),
            Err(_) => {
                cancel_stalled(&bridge, &id).await;
                break Err(STALLED_ERROR.to_string());
            }
        };
        match val.get("event").and_then(Value::as_str).unwrap_or("") {
            "ack" | "heartbeat" => {}
            "error" => break Err(val.get("message").and_then(Value::as_str).unwrap_or("error").to_string()),
            "end" => break Ok(()),
            _ => captured = val.clone(),
        }
    };
    bridge.unsubscribe(&id).await;
    result.map(|()| captured)
}

/// Writes and does not wait: the continuation arrives through the already open turn.
async fn fire(bridge: &Arc<Bridge>, mut payload: Value, typ: Option<&str>) -> Result<(), String> {
    check_payload(&payload)?;
    bridge.ensure_started().await?;
    if let (Some(t), Some(o)) = (typ, payload.as_object_mut()) {
        o.insert("type".into(), Value::String(t.into()));
    }
    let (req, _) = with_id(payload);
    bridge.write(&req).await
}

#[tauri::command]
pub async fn tool_confirm(bridge: State<'_, Arc<Bridge>>, payload: Value) -> Result<(), String> {
    fire(&bridge, payload, None).await
}

#[tauri::command]
pub async fn ask_answer(bridge: State<'_, Arc<Bridge>>, payload: Value) -> Result<(), String> {
    fire(&bridge, payload, None).await
}

#[tauri::command]
pub async fn cancel_stream(bridge: State<'_, Arc<Bridge>>, payload: Value) -> Result<(), String> {
    if payload.get("id").and_then(Value::as_str).unwrap_or("").is_empty() {
        return Ok(()); // without an id there is nothing to cancel
    }
    fire(&bridge, payload, Some("cancel")).await
}

/// The Studio window answers a `studio_call` from the agent's Studio tool.
#[tauri::command]
pub async fn studio_result(bridge: State<'_, Arc<Bridge>>, payload: Value) -> Result<(), String> {
    fire(&bridge, payload, Some("studio_result")).await
}

/// BuiltBot asks for it when it mounts. Studio starts the agent lazily, when the column opens: here
/// it waits for the start so as not to answer «not running» to a bridge that was starting.
#[tauri::command]
pub async fn bridge_status(bridge: State<'_, Arc<Bridge>>) -> Result<Value, String> {
    let _ = bridge.ensure_started().await; // a failure stays in the status: the error view shows it
    Ok(bridge.builtbot_status())
}

#[tauri::command]
pub async fn restart_bridge(bridge: State<'_, Arc<Bridge>>) -> Result<(), String> {
    bridge.restart().await
}

#[tauri::command]
pub async fn graph_request(_payload: Value) -> Result<(), String> {
    Err("Graphs are not available in Dream BIM".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    #[test]
    fn with_id_sets_the_id() {
        let (p, id) = with_id(json!({"type": "chat"}));
        assert_eq!(p["id"], id.as_str());
        let (_, otro) = with_id(json!({"type": "chat"}));
        assert_ne!(id, otro);
        let (_, id) = with_id(json!({"type": "chat", "id": "t1"}));
        assert_eq!(id, "t1");
    }

    #[test]
    fn no_command_changes_the_folder() {
        // the bridge dispatches by `type` whichever command it comes through: the guard applies to all of them
        let reason = Err("The project folder is fixed inside Dream BIM".to_string());
        assert_eq!(check_payload(&json!({"type": "set_workspace", "path": "C:/other"})), reason);
        assert_eq!(check_payload(&json!({"type": "clear_workspace"})), reason);
        assert_eq!(check_payload(&json!({"type": "chat", "text": "hola"})), Ok(()));
        assert_eq!(check_payload(&json!({"type": "tool_confirm"})), Ok(()));
    }

    #[test]
    fn the_folder_cannot_be_changed() {
        let reason = Some("The project folder is fixed inside Dream BIM");
        assert_eq!(refuses_workspace(&json!({"type": "set_workspace", "path": "C:/other"})), reason);
        assert_eq!(refuses_workspace(&json!({"type": "clear_workspace"})), reason);
        assert_eq!(refuses_workspace(&json!({"type": "conv_list"})), None);
        assert_eq!(refuses_workspace(&json!({"type": "get_model"})), None);
    }

    type Events = std::sync::Arc<Mutex<Vec<(String, Value)>>>;

    fn recorder() -> (Events, impl Fn(&str, &Value) + Send + Sync) {
        let events = std::sync::Arc::new(Mutex::new(Vec::new()));
        let e = events.clone();
        (events, move |n: &str, v: &Value| e.lock().unwrap().push((n.to_string(), v.clone())))
    }

    #[test]
    fn turn_emits_start_and_end() {
        let (events, emit) = recorder();
        {
            let _g = TurnGuard::new("t1", emit);
        }
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                ("studio://turn-start".to_string(), json!({"id": "t1"})),
                ("studio://turn-end".to_string(), json!({"id": "t1"})),
            ]
        );
    }

    #[test]
    fn turn_emits_end_even_when_it_fails() {
        let (events, emit) = recorder();
        fn turn(emit: impl Fn(&str, &Value) + Send + Sync) -> Result<(), String> {
            let _g = TurnGuard::new("t2", emit);
            Err("bridge closed".to_string())?;
            Ok(())
        }
        assert!(turn(emit).is_err());
        let names: Vec<String> = events.lock().unwrap().iter().map(|(n, _)| n.clone()).collect();
        assert_eq!(names, vec!["studio://turn-start", "studio://turn-end"]);
    }

    fn silent_channel() -> (tokio::sync::mpsc::UnboundedSender<Value>, tokio::sync::mpsc::UnboundedReceiver<Value>) {
        tokio::sync::mpsc::unbounded_channel()
    }

    #[tokio::test(start_paused = true)]
    async fn turn_ends_when_the_bridge_goes_silent() {
        let (_tx, mut rx) = silent_channel(); // the sender stays alive: the channel is open but silent
        let (events, emit) = recorder();
        let end = {
            let _guard = TurnGuard::new("t3", emit);
            pump(&mut rx, TURN_IDLE_TIMEOUT, &["delta"], |_, _| Ok(())).await
        };
        assert!(matches!(end, PumpEnd::Stalled));
        let names: Vec<String> = events.lock().unwrap().iter().map(|(n, _)| n.clone()).collect();
        assert_eq!(names, vec!["studio://turn-start", "studio://turn-end"]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_heartbeat_resets_the_idle_clock() {
        let (tx, mut rx) = silent_channel();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(100)).await;
            tx.send(json!({"event": "heartbeat"})).unwrap();
            tokio::time::sleep(std::time::Duration::from_secs(100)).await;
            tx.send(json!({"event": "end"})).unwrap();
        });
        let mut forwarded = Vec::new();
        let end = pump(&mut rx, TURN_IDLE_TIMEOUT, &["heartbeat", "end"], |name, _| {
            forwarded.push(name.to_string());
            Ok(())
        })
        .await;
        assert!(matches!(end, PumpEnd::Done), "200 s in total, but never 120 s without an event");
        assert_eq!(forwarded, vec!["heartbeat", "end"]);
    }

    #[tokio::test(start_paused = true)]
    async fn only_the_listed_events_are_forwarded_and_end_finishes() {
        let (tx, mut rx) = silent_channel();
        for event in ["delta", "tool", "end", "delta"] {
            tx.send(json!({"event": event})).unwrap();
        }
        let mut forwarded = Vec::new();
        let end = pump(&mut rx, TURN_IDLE_TIMEOUT, &["delta", "end"], |name, _| {
            forwarded.push(name.to_string());
            Ok(())
        })
        .await;
        assert!(matches!(end, PumpEnd::Done));
        assert_eq!(forwarded, vec!["delta", "end"]); // "tool" is not listed; nothing after "end"
    }

    #[tokio::test(start_paused = true)]
    async fn a_failing_emit_and_a_closed_channel_end_the_turn() {
        let (tx, mut rx) = silent_channel();
        tx.send(json!({"event": "delta"})).unwrap();
        let end = pump(&mut rx, TURN_IDLE_TIMEOUT, &["delta"], |_, _| Err("window gone".to_string())).await;
        assert!(matches!(end, PumpEnd::EmitFailed(e) if e == "window gone"));

        drop(tx);
        let end = pump(&mut rx, TURN_IDLE_TIMEOUT, &["delta"], |_, _| Ok(())).await;
        assert!(matches!(end, PumpEnd::Closed));
    }
}
