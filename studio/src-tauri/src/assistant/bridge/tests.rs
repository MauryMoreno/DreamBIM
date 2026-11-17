use super::*;
use serde_json::json;

#[test]
fn route_matches_chatbot() {
    let v = json!({"id": "a", "event": "x"});
    assert!(matches!(route(&v, true), Route::Sub));
    let push = json!({"event": "x", "push": true});
    assert!(matches!(route(&push, false), Route::Push(e) if e == "x"));
    assert!(matches!(route(&v, false), Route::Drop));
}

#[tokio::test]
async fn dispatch_delivers_by_id() {
    let b = Bridge::new();
    let mut a = b.subscribe("a").await;
    let mut c = b.subscribe("b").await;
    b.dispatch_line(r#"{"id":"a","event":"delta"}"#).await;
    assert_eq!(a.try_recv().unwrap()["event"], "delta");
    assert!(c.try_recv().is_err());
}

#[tokio::test]
async fn dispatch_ignores_garbage() {
    let b = Bridge::new();
    let mut a = b.subscribe("a").await;
    b.dispatch_line("no json").await;
    b.dispatch_line("").await;
    assert!(a.try_recv().is_err());
}

#[tokio::test]
async fn events_use_the_names_of_builtbot() {
    let b = Bridge::new();
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, Value)>::new()));
    let v = seen.clone();
    b.set_emitter(Box::new(move |n, p| v.lock().unwrap().push((n.to_string(), p.clone()))));
    b.dispatch_line(r#"{"event":"subagent_report","push":true}"#).await;
    b.fail("boom".to_string());
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].0, "push://subagent_report");
    assert_eq!(seen[1].0, "bridge://error");
    assert_eq!(seen[1].1["error"], "boom");
    assert_eq!(seen[1].1["running"], false);
    assert!(seen[1].1["log"].is_string());
}

#[test]
fn builtbot_does_not_see_a_bridge_with_an_error_as_running() {
    // started but with a failed set_workspace: for BuiltBot it is not running (its error view says so)
    let b = Bridge::new();
    b.running.store(true, Ordering::SeqCst);
    b.fail("The assistant did not answer in time".to_string());
    let s = b.builtbot_status();
    assert_eq!(s["running"], false);
    assert_eq!(s["error"], "The assistant did not answer in time");
}

#[test]
fn status_before_starting() {
    let s = Bridge::new().status();
    assert_eq!(s["running"], false);
    assert!(s["error"].is_null());
}

#[test]
fn log_is_rotated_when_too_large() {
    let dir = std::env::temp_dir().join(format!("dream_bim_log_{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).unwrap();
    let log = dir.join("bridge.log");
    std::fs::write(&log, "0123456789ABC").unwrap(); // 13 bytes, limit 10
    std::fs::write(dir.join("bridge.log.1"), "older").unwrap();

    let file = open_log(&log, 10).unwrap();
    drop(file);
    assert_eq!(std::fs::read_to_string(dir.join("bridge.log.1")).unwrap(), "0123456789ABC", "the big log became .1");
    assert_eq!(std::fs::metadata(&log).unwrap().len(), 0, "a fresh log was started");

    std::fs::write(&log, "small").unwrap();
    drop(open_log(&log, 10).unwrap());
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "small", "a log under the limit is kept and appended to");
    std::fs::remove_dir_all(&dir).ok();
}
