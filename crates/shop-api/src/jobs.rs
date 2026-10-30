//! Index jobs: "read the sources for this search now". One per search, at most a few at a time,
//! each with progress that anything can poll.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use financer_shop_sources::{
    Cancel, IndexReport, IndexRequest, Phase, ProgressRx, ProgressState, ProgressTx,
};
use serde::Serialize;

const KEEP_FINISHED: usize = 20;

#[derive(Clone)]
pub struct Job {
    pub id: String,
    pub request: IndexRequest,
    pub started_at: i64,
    pub progress: ProgressTx,
    pub rx: ProgressRx,
    pub cancel: Cancel,
    pub report: Arc<Mutex<Option<IndexReport>>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobView {
    pub id: String,
    pub query: String,
    pub category: Option<String>,
    pub started_at: i64,
    pub progress: ProgressState,
    pub report: Option<IndexReport>,
}

impl Job {
    pub fn view(&self) -> JobView {
        JobView {
            id: self.id.clone(),
            query: self.request.query.clone(),
            category: self.request.category.clone(),
            started_at: self.started_at,
            progress: self.rx.borrow().clone(),
            report: self.report.lock().expect("report lock").clone(),
        }
    }

    fn running(&self) -> bool {
        !self.rx.borrow().phase.finished()
    }

    fn same_search(&self, req: &IndexRequest) -> bool {
        self.request.query.trim().to_lowercase() == req.query.trim().to_lowercase()
            && self.request.category == req.category
            && self.request.sources == req.sources
    }
}

#[derive(Default)]
pub struct Jobs {
    jobs: Mutex<VecDeque<Job>>,
}

pub enum Admission {
    /// A new job was registered; the caller must run it.
    Started(Job),
    /// The same search is already running.
    Running(Job),
    /// Too many jobs at once.
    Busy,
}

impl Jobs {
    pub fn admit(&self, req: IndexRequest, now: i64, max_running: usize) -> Admission {
        let mut jobs = self.jobs.lock().expect("jobs lock");
        if let Some(j) = jobs.iter().find(|j| j.running() && j.same_search(&req)) {
            return Admission::Running(j.clone());
        }
        if jobs.iter().filter(|j| j.running()).count() >= max_running {
            return Admission::Busy;
        }
        let (progress, rx) = ProgressTx::new();
        let job = Job {
            id: uuid::Uuid::new_v4().simple().to_string(),
            request: req,
            started_at: now,
            progress,
            rx,
            cancel: Cancel::new(),
            report: Arc::new(Mutex::new(None)),
        };
        jobs.push_front(job.clone());
        // forget old finished jobs
        let mut finished = 0;
        jobs.retain(|j| {
            if j.running() {
                return true;
            }
            finished += 1;
            finished <= KEEP_FINISHED
        });
        Admission::Started(job)
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.jobs
            .lock()
            .expect("jobs lock")
            .iter()
            .find(|j| j.id == id)
            .cloned()
    }

    pub fn list(&self) -> Vec<JobView> {
        self.jobs
            .lock()
            .expect("jobs lock")
            .iter()
            .map(Job::view)
            .collect()
    }

    pub fn any_running(&self) -> bool {
        self.jobs
            .lock()
            .expect("jobs lock")
            .iter()
            .any(Job::running)
    }
}

impl Job {
    pub fn finish_failed(&self, message: &str) {
        self.progress.update(|s| {
            s.phase = Phase::Failed;
            s.message = message.to_string();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(q: &str) -> IndexRequest {
        IndexRequest {
            query: q.into(),
            ..IndexRequest::default()
        }
    }

    #[test]
    fn the_same_search_is_not_started_twice_and_the_number_of_jobs_is_limited() {
        let jobs = Jobs::default();
        let Admission::Started(a) = jobs.admit(req("Pixel 9"), 1, 2) else {
            panic!("started")
        };
        assert!(
            matches!(jobs.admit(req("  pixel 9 "), 2, 2), Admission::Running(j) if j.id == a.id)
        );
        assert!(matches!(
            jobs.admit(req("galaxy"), 3, 2),
            Admission::Started(_)
        ));
        assert!(matches!(jobs.admit(req("iphone"), 4, 2), Admission::Busy));
        assert_eq!(jobs.list().len(), 2);

        a.progress.update(|s| s.phase = Phase::Done);
        assert!(matches!(
            jobs.admit(req("iphone"), 5, 2),
            Admission::Started(_)
        ));
        assert!(jobs.get(&a.id).is_some());
        assert!(jobs.any_running());
    }

    #[test]
    fn finished_jobs_are_forgotten_after_a_while() {
        let jobs = Jobs::default();
        for i in 0..30 {
            let Admission::Started(j) = jobs.admit(req(&format!("q{i}")), i, 5) else {
                panic!("started")
            };
            j.progress.update(|s| s.phase = Phase::Done);
        }
        assert_eq!(
            jobs.list().len(),
            KEEP_FINISHED + 1,
            "the 20 newest finished jobs and the one still running"
        );
    }
}
