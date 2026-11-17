//! Idle limits for the Assistant bridge: a turn that goes silent must end, so the edit lock is never left on
//! when the Python process hangs without exiting.

use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc::UnboundedReceiver;

/// A chat turn may stay silent this long (no event, not even a heartbeat) before it is cancelled.
/// The same limit as `IDLE_MS` of the web backend.
pub const TURN_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
/// A request with an answer (conversation list, graph...) may stay silent this long.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// The bridge log is rotated (to `<log>.1`) when it grows past this.
pub const BRIDGE_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Nothing arrived within the idle limit.
#[derive(Debug)]
pub struct IdleTimeout;

/// The next event of a request, waiting at most `idle`. `Ok(None)` means the bridge closed the channel.
/// Every call starts a fresh idle period, so any event (a heartbeat included) keeps the turn alive.
pub async fn recv_or_idle(rx: &mut UnboundedReceiver<Value>, idle: Duration) -> Result<Option<Value>, IdleTimeout> {
    tokio::time::timeout(idle, rx.recv()).await.map_err(|_| IdleTimeout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;
    use tokio::sync::mpsc;

    #[tokio::test(start_paused = true)]
    async fn gives_the_event_when_one_arrives_in_time() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        tx.send(json!({"event": "delta"})).unwrap();
        let got = recv_or_idle(&mut rx, Duration::from_secs(120)).await;
        assert_eq!(got.unwrap().unwrap()["event"], "delta");
    }

    #[tokio::test(start_paused = true)]
    async fn reports_idle_when_nothing_arrives() {
        let (_tx, mut rx) = mpsc::unbounded_channel::<serde_json::Value>();
        let got = recv_or_idle(&mut rx, Duration::from_secs(120)).await;
        assert!(matches!(got, Err(IdleTimeout)));
    }

    #[tokio::test(start_paused = true)]
    async fn a_closed_channel_is_not_idle() {
        let (tx, mut rx) = mpsc::unbounded_channel::<serde_json::Value>();
        drop(tx);
        assert!(matches!(recv_or_idle(&mut rx, Duration::from_secs(120)).await, Ok(None)));
    }

    #[test]
    fn the_limits_are_the_ones_of_the_web_backend() {
        assert_eq!(TURN_IDLE_TIMEOUT, Duration::from_secs(120));
        assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(60));
        assert_eq!(BRIDGE_LOG_MAX_BYTES, 5 * 1024 * 1024);
    }
}
