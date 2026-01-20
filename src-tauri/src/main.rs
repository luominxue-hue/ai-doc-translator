use std::{fs, time::{Duration, Instant}, sync::Mutex, path::PathBuf, process::Command};
use serde::Deserialize;
use tauri::{Manager, State};

#[derive(Default)]
struct BackendState(Mutex<Option<String>>);

#[derive(Deserialize)]
struct PortInfo {
  host: String,
  port: u16,
  pid: i32
}

#[tauri::command]
fn get_backend_base_url(state: State<BackendState>) -> Option<String> {
  state.0.lock().unwrap().clone()
}

fn wait_for_backend(port_file: &std::path::Path) -> anyhow::Result<String> {
  let start = Instant::now();
  let timeout = Duration::from_secs(20);

  let port_info: PortInfo = loop {
    if start.elapsed() > timeout {
      anyhow::bail!("timeout waiting for port-file");
    }
    if let Ok(s) = fs::read_to_string(port_file) {
      if let Ok(info) = serde_json::from_str::<PortInfo>(&s) {
        break info;
      }
    }
    std::thread::sleep(Duration::from_millis(80));
  };

  let base = format!("http://{}:{}", port_info.host, port_info.port);

  let client = reqwest::blocking::Client::new();
  loop {
    if start.elapsed() > timeout {
      anyhow::bail!("timeout waiting for /api/health");
    }
    let ok = client
      .get(format!("{}/api/health", base))
      .timeout(Duration::from_millis(600))
      .send()
      .map(|r| r.status().is_success())
      .unwrap_or(false);
    if ok { break; }
    std::thread::sleep(Duration::from_millis(80));
  }

  Ok(base)
}

fn backend_exe_path() -> anyhow::Result<PathBuf> {
  let exe = std::env::current_exe()?;
  let dir = exe.parent().ok_or_else(|| anyhow::anyhow!("no exe parent"))?;
  Ok(dir.join("mvp_backend.exe"))
}

fn main() {
  tauri::Builder::default()
    .manage(BackendState::default())
    .invoke_handler(tauri::generate_handler![get_backend_base_url])
    .setup(|app| {
      let data_dir = app.path().app_data_dir().unwrap();
      std::fs::create_dir_all(&data_dir)?;

      let port_file = data_dir.join(format!("backend-port-{}.json", uuid::Uuid::new_v4()));
      if port_file.exists() { let _ = std::fs::remove_file(&port_file); }

      let backend = backend_exe_path()?;
      if !backend.exists() {
        anyhow::bail!("missing backend exe: {}", backend.display());
      }

      Command::new(backend)
        .args([
          "--host", "127.0.0.1",
          "--port-file", port_file.to_string_lossy().as_ref(),
        ])
        .env("MVP_DATA_DIR", data_dir.to_string_lossy().as_ref())
        .spawn()?;

      let base_url = wait_for_backend(&port_file)?;
      *app.state::<BackendState>().0.lock().unwrap() = Some(base_url);

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
