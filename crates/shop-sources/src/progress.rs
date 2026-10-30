//! Progress of an index run, readable from anywhere (the API, a notification) while it runs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::watch;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

impl Phase {
    pub fn finished(self) -> bool {
        matches!(self, Phase::Done | Phase::Failed | Phase::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressState {
    pub phase: Phase,
    /// What is happening now ("Reading shop.example"), for the notification text.
    pub message: String,
    /// Pages read so far and pages known so far (grows while links are discovered).
    pub done: usize,
    pub total: usize,
    pub products: usize,
    pub failed: usize,
    /// 0..=100. Never goes back, and stays below 100 until the run is finished, so a bar that
    /// grows with discovered pages does not jump around.
    pub percent: u8,
}

impl ProgressState {
    pub fn queued() -> ProgressState {
        ProgressState {
            phase: Phase::Queued,
            message: "Waiting to start".into(),
            done: 0,
            total: 0,
            products: 0,
            failed: 0,
            percent: 0,
        }
    }
}

/// The writing end, held by the run.
#[derive(Clone)]
pub struct ProgressTx(Arc<watch::Sender<ProgressState>>);

pub type ProgressRx = watch::Receiver<ProgressState>;

impl ProgressTx {
    pub fn new() -> (ProgressTx, ProgressRx) {
        let (tx, rx) = watch::channel(ProgressState::queued());
        (ProgressTx(Arc::new(tx)), rx)
    }

    pub fn update(&self, f: impl FnOnce(&mut ProgressState)) {
        self.0.send_modify(|s| {
            let before = s.percent;
            f(s);
            let raw = (s.done * 100)
                .checked_div(s.total)
                .map_or(0, |p| p.min(99) as u8);
            s.percent = match s.phase {
                Phase::Done => 100,
                _ => raw.max(before).min(99),
            };
        });
    }

    pub fn snapshot(&self) -> ProgressState {
        self.0.borrow().clone()
    }
}

/// A flag a run checks between pages; set it to stop the run cleanly.
#[derive(Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Cancel {
        Cancel::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_grows_with_pages_never_shrinks_and_hits_100_only_when_done() {
        let (tx, rx) = ProgressTx::new();
        tx.update(|s| {
            s.phase = Phase::Running;
            s.total = 2;
        });
        tx.update(|s| s.done = 1);
        assert_eq!(rx.borrow().percent, 50);
        // more pages are discovered: the bar must not go back
        tx.update(|s| s.total = 10);
        assert_eq!(rx.borrow().percent, 50);
        tx.update(|s| s.done = 10);
        assert_eq!(rx.borrow().percent, 99);
        tx.update(|s| s.phase = Phase::Done);
        assert_eq!(rx.borrow().percent, 100);
    }

    #[test]
    fn cancel_is_shared_between_clones() {
        let c = Cancel::new();
        let d = c.clone();
        assert!(!d.is_cancelled());
        c.cancel();
        assert!(d.is_cancelled());
    }
}
