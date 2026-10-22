//! The real server binary: a change saved from the app restarts it in place and applies, and a
//! change that does not start is taken back. Nothing here is mocked; the test talks HTTP to a
//! child process.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct Server {
    child: Child,
    dir: tempfile::TempDir,
    port: u16,
}

impl Server {
    /// A server with its own folder, database and a config file that sets the listen address.
    fn start() -> Server {
        let dir = tempfile::tempdir().unwrap();
        let port = free_port();
        std::fs::write(
            dir.path().join("financer.toml"),
            format!("[server]\nbind = \"127.0.0.1:{port}\"\n"),
        )
        .unwrap();
        let child = Command::new(env!("CARGO_BIN_EXE_financer-server"))
            .current_dir(dir.path())
            .env_clear()
            .env("FINANCER_API_TOKEN", TOKEN)
            .env(
                "FINANCER_DATABASE_URL",
                format!("sqlite://{}/f.db?mode=rwc", dir.path().display()),
            )
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start the server");
        let s = Server { child, dir, port };
        s.wait_until(|_| true, "the server to come up");
        s
    }

    /// One HTTP/1.1 request; `None` while the server is not answering.
    fn request(&self, method: &str, body: Option<&str>) -> Option<(u16, serde_json::Value)> {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).ok()?;
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
        let body = body.unwrap_or("");
        let req = format!(
            "{method} /v1/server-config HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(req.as_bytes()).ok()?;
        let mut raw = String::new();
        stream.read_to_string(&mut raw).ok()?;
        let (head, payload) = raw.split_once("\r\n\r\n")?;
        let status = head.split_whitespace().nth(1)?.parse().ok()?;
        // the body may be chunked; the JSON is what is between the first { and the last }
        let json = payload
            .find('{')
            .zip(payload.rfind('}'))
            .and_then(|(a, b)| serde_json::from_str(&payload[a..=b]).ok())
            .unwrap_or(serde_json::Value::Null);
        Some((status, json))
    }

    fn view(&self) -> Option<serde_json::Value> {
        self.request("GET", None)
            .filter(|(s, _)| *s == 200)
            .map(|(_, v)| v)
    }

    fn key(view: &serde_json::Value, path: &str) -> serde_json::Value {
        view["groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["keys"].as_array().unwrap().iter())
            .find(|k| k["path"] == path)
            .unwrap()
            .clone()
    }

    /// Poll the view until `ready` accepts it.
    fn wait_until(
        &self,
        ready: impl Fn(&serde_json::Value) -> bool,
        what: &str,
    ) -> serde_json::Value {
        let deadline = Instant::now() + Duration::from_secs(40);
        while Instant::now() < deadline {
            if let Some(v) = self.view() {
                if ready(&v) {
                    return v;
                }
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        panic!("timed out waiting for {what}");
    }

    fn settings_file(&self) -> String {
        std::fs::read_to_string(self.dir.path().join("financer.settings.json")).unwrap_or_default()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn a_saved_change_restarts_the_server_in_place_and_applies() {
    let mut s = Server::start();
    let view = s.view().unwrap();
    assert_eq!(
        Server::key(&view, "server.refresh_hours")["source"],
        "default"
    );
    let pid = s.child.id();

    let (status, saved) = s
        .request(
            "PUT",
            Some(
                r#"{"set":{"server.refresh_hours":5,"llm.openai_api_key":"sk-typed-in-the-app"}}"#,
            ),
        )
        .unwrap();
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["restarting"], true);

    // it comes back with the value, and the settings file no longer calls the change unproven
    // (the old process still shows the saved value, with applying = true; the new one does not)
    let view = s.wait_until(
        |v| v["applying"] == false && Server::key(v, "server.refresh_hours")["source"] == "app",
        "the new setting to apply",
    );
    assert_eq!(Server::key(&view, "server.refresh_hours")["value"], 5);
    let key = Server::key(&view, "llm.openai_api_key");
    assert_eq!(
        (key["is_set"].as_bool(), key["source"].as_str()),
        (Some(true), Some("app"))
    );
    assert!(!view.to_string().contains("sk-typed-in-the-app"));
    assert_eq!(view["state"], "ok");
    assert!(
        s.child.try_wait().unwrap().is_none(),
        "the same process is still running (it restarted in place)"
    );
    assert_eq!(s.child.id(), pid);
    assert!(
        !s.settings_file().contains("\"pending\""),
        "{}",
        s.settings_file()
    );
    assert!(s.settings_file().contains("sk-typed-in-the-app"));
}

#[test]
fn a_change_that_does_not_start_is_taken_back() {
    let s = Server::start();
    let before = Server::key(&s.view().unwrap(), "server.bind")["value"].clone();

    // an address that is taken, so the restart cannot bind it
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let taken_addr = taken.local_addr().unwrap();
    let body = format!(r#"{{"set":{{"server.bind":"{taken_addr}"}}}}"#);
    let (status, saved) = s.request("PUT", Some(&body)).unwrap();
    assert_eq!(status, 200, "{saved}");

    // the server ends up where it was, and says what happened
    let view = s.wait_until(
        |v| v["state"] == "rolled_back" && v["applying"] == false,
        "the change to be taken back",
    );
    let message = view["message"].as_str().unwrap();
    assert!(message.contains("did not start"), "{message}");
    let bind = Server::key(&view, "server.bind");
    assert_eq!(bind["value"], before);
    assert_eq!(bind["source"], "file");
    drop(taken);
}
