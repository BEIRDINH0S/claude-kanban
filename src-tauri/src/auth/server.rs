//! One-shot loopback HTTP server for the OAuth redirect.
//!
//! We bind to `127.0.0.1:0` so the OS picks a free port, then read it back
//! to construct the `redirect_uri`. The server lives just long enough to
//! receive a single GET on `/callback?code=...&state=...`, then shuts down.
//!
//! HTTP parsing is hand-rolled: we only need the request line (URL with
//! query string), and we send a fixed HTML success/error page back. No
//! `tiny_http`/`hyper` dep needed for that.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

/// Result of a successful callback handshake.
#[derive(Debug)]
pub struct CallbackResult {
    pub code: String,
    pub state: String,
}

pub struct CallbackServer {
    pub listener: TcpListener,
    pub port: u16,
}

impl CallbackServer {
    pub async fn bind() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("bind loopback: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("local_addr: {e}"))?
            .port();
        Ok(Self { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    /// Wait for the callback. Hard timeout of 5 minutes — if the user
    /// abandons the flow we don't want a zombie listener forever. Loops
    /// over connections so a curious browser pre-fetch / scanner doesn't
    /// hijack the slot before the real callback arrives.
    pub async fn wait(self) -> Result<CallbackResult, String> {
        let CallbackServer { listener, .. } = self;
        let work = async move {
            loop {
                let (mut stream, _) = listener
                    .accept()
                    .await
                    .map_err(|e| format!("accept: {e}"))?;

                // Read the request line (and a bit more to be safe). We don't
                // care about headers/body — only the GET line matters.
                let mut buf = [0u8; 4096];
                let n = match timeout(Duration::from_secs(10), stream.read(&mut buf)).await {
                    Ok(Ok(n)) => n,
                    _ => {
                        // Drop this connection and wait for the next one.
                        let _ = stream.shutdown().await;
                        continue;
                    }
                };
                if n == 0 {
                    continue;
                }

                let request = String::from_utf8_lossy(&buf[..n]);
                let path = match parse_request_line(&request) {
                    Some(p) => p,
                    None => {
                        respond(&mut stream, 400, "Bad Request").await;
                        continue;
                    }
                };

                // Ignore favicon / unrelated paths.
                if !path.starts_with("/callback") {
                    respond(&mut stream, 404, "Not found").await;
                    continue;
                }

                let (code, state, error) = parse_callback_query(&path);

                if let Some(err) = error {
                    respond_html(
                        &mut stream,
                        400,
                        &error_page(&err),
                    )
                    .await;
                    return Err(format!("authorization error: {err}"));
                }

                let (Some(code), Some(state)) = (code, state) else {
                    respond_html(
                        &mut stream,
                        400,
                        &error_page("missing code/state"),
                    )
                    .await;
                    continue; // wait for a proper callback
                };

                respond_html(&mut stream, 200, SUCCESS_PAGE).await;
                return Ok(CallbackResult { code, state });
            }
        };

        // Outer timeout so the listener doesn't hang the app forever.
        match timeout(Duration::from_secs(300), work).await {
            Ok(r) => r,
            Err(_) => Err("login timed out (5 min)".to_string()),
        }
    }
}

/// Return the path+query from a raw HTTP/1.1 request: `GET /callback?... HTTP/1.1`.
fn parse_request_line(req: &str) -> Option<String> {
    let line = req.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    if method != "GET" {
        return None;
    }
    Some(path.to_string())
}

/// Decode `code`, `state`, `error` from a path like `/callback?code=…&state=…`.
fn parse_callback_query(path: &str) -> (Option<String>, Option<String>, Option<String>) {
    let q = match path.split_once('?') {
        Some((_, q)) => q,
        None => return (None, None, None),
    };
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for kv in q.split('&') {
        let (k, v) = match kv.split_once('=') {
            Some(pair) => pair,
            None => continue,
        };
        let decoded = urlencoding::decode(v).map(|c| c.into_owned()).ok();
        match k {
            "code" => code = decoded,
            "state" => state = decoded,
            "error" => error = decoded,
            "error_description" => {
                if error.is_none() {
                    error = decoded;
                }
            }
            _ => {}
        }
    }
    (code, state, error)
}

async fn respond(stream: &mut tokio::net::TcpStream, status: u16, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        reason = reason_phrase(status),
        len = body.len(),
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn respond_html(stream: &mut tokio::net::TcpStream, status: u16, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        reason = reason_phrase(status),
        len = body.len(),
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    }
}

const SUCCESS_PAGE: &str = r#"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Connecté à Claude</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0;
         background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f1f5f9; }
  .card { padding: 40px 48px; border-radius: 16px; background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08); text-align: center;
          box-shadow: 0 30px 60px -20px rgba(0,0,0,0.5); }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0; opacity: 0.7; font-size: 13px; }
  .check { width: 48px; height: 48px; border-radius: 50%; background: rgba(16,185,129,0.15);
           display: grid; place-items: center; margin: 0 auto 16px; color: #10b981; font-size: 24px; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>Connecté à Claude</h1>
    <p>Tu peux fermer cet onglet et revenir dans claude-kanban.</p>
  </div>
</body>
</html>"#;

fn error_page(message: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Erreur de connexion</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0;
         background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f1f5f9; }}
  .card {{ padding: 40px 48px; border-radius: 16px; background: rgba(255,255,255,0.04);
          border: 1px solid rgba(239,68,68,0.3); text-align: center;
          box-shadow: 0 30px 60px -20px rgba(0,0,0,0.5); max-width: 480px; }}
  h1 {{ margin: 0 0 8px; font-size: 18px; font-weight: 600; }}
  pre {{ margin: 8px 0 0; opacity: 0.7; font-size: 12px; white-space: pre-wrap; word-break: break-word; }}
</style>
</head>
<body>
  <div class="card">
    <h1>Erreur de connexion</h1>
    <pre>{}</pre>
  </div>
</body>
</html>"#,
        html_escape(message)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
