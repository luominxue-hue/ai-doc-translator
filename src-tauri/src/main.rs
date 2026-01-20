use serde::Deserialize;
use std::{
  fs,
  io,
  path::{Path, PathBuf},
  process::Command,
  sync::Mutex,
  time::{Duration, Instant},
};
use tauri::State;

#[derive(Default)]
struct BackendState(Mutex<Option<String>>);

#[derive(Deserialize)]
struct PortInfo {
  host: String,
  port: u16,
  pid: i64,
}

#[tauri::command]
fn get_backend_base_url(state: State<BackendState>) -> Option<String> {
  state.0.lock().unwrap().clone()
}

fn boxed_err(msg: impl Into<String>) -> Box<dyn std::error::Error> {
  Box::new(io::Error::new(io::ErrorKind::Other, msg.into()))
}

fn backend_exe_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
  let exe = std::env::current_exe()?;
  let dir = exe
    .parent()
    .ok_or_else(|| boxed_err("Cannot determine executable directory"))?;
  Ok(dir.join("mvp_backend.exe"))
}

fn atomic_write(path: &Path, content: &str) -> Result<(), Box<dyn std::error::Error>> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let tmp = path.with_extension("tmp");
  fs::write(&tmp, content)?;
  fs::rename(tmp, path)?;
  Ok(())
}

fn wait_for_backend(port_file: &Path) -> Result<String, Box<dyn std::error::Error>> {
  let start = Instant::now();
  let timeout = Duration::from_secs(25);

  // 1) wait port-file
  let port_info: PortInfo = loop {
    if start.elapsed() > timeout {
      return Err(boxed_err("Timeout waiting for backend port-file"));
    }
    if let Ok(s) = fs::read_to_string(port_file) {
      if let Ok(info) = serde_json::from_str::<PortInfo>(&s) {
        break info;
      }
    }
    std::thread::sleep(Duration::from_millis(80));
  };

  let base = format!("http://{}:{}", port_info.host, port_info.port);

  // 2) wait /api/health
  let client = reqwest::blocking::Client::new();
  loop {
    if start.elapsed() > timeout {
      return Err(boxed_err("Timeout waiting for backend /api/health"));
    }
    let ok = client
      .get(format!("{}/api/health", base))
      .timeout(Duration::from_millis(800))
      .send()
      .map(|r| r.status().is_success())
      .unwrap_or(false);

    if ok {
      break;
    }
    std::thread::sleep(Duration::from_millis(100));
  }

  Ok(base)
}

fn main() {
  tauri::Builder::default()
    .manage(BackendState::default())
    .invoke_handler(tauri::generate_handler![get_backend_base_url])
    .setup(|app| {
      // NOTE: this closure must return Result<(), Box<dyn Error>>
      let data_dir = app.path().app_data_dir()?;
      fs::create_dir_all(&data_dir)?;

      // unique port-file name to avoid conflicts
      let port_file = data_dir.join(format!("backend-port-{}.json", uuid::Uuid::new_v4()));
      if port_file.exists() {
        let _ = fs::remove_file(&port_file);
      }

      // make sure port-file is writable (optional, for quick validation)
      atomic_write(&port_file, "")?;
      let _ = fs::remove_file(&port_file);

      let backend = backend_exe_path()?;
      if !backend.exists() {
        return Err(boxed_err(format!(
          "Missing backend exe next to app: {}",
          backend.display()
        )));
      }

      // spawn backend
      Command::new(&backend)
        .args([
          "--host",
          "127.0.0.1",
          "--port-file",
          port_file.to_string_lossy().as_ref(),
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
