mod settings;
mod video;

use std::{
    net::TcpListener,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Response, StatusCode, header},
    routing::get,
};
use bytes::Bytes;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use settings::{AppSettings, CameraPreference, ConnectInput, StreamKind};
use tauri::Manager;
use tokio::net::TcpListener as TokioListener;
use video::{StreamManager, StreamStatus};

pub struct AppState {
    db: Mutex<Connection>,
    stream_manager: Arc<StreamManager>,
    stream_port: u16,
    pip_channel: Mutex<Option<u8>>,
    active_credentials: Mutex<Option<ActiveCredentials>>,
}

#[derive(Clone)]
struct ActiveCredentials {
    host: String,
    port: u16,
    username: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionResult {
    settings: AppSettings,
    stream_port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReconnectResult {
    cameras: Vec<CameraPreference>,
    stream_port: u16,
}

#[derive(Deserialize)]
struct StreamUpdate {
    channel: u8,
    stream: StreamKind,
}

#[tauri::command]
fn load_settings(state: tauri::State<'_, Arc<AppState>>) -> Result<AppSettings, String> {
    let mut settings = settings::load(&state.db)?;
    if settings.remember_password {
        let expired = settings
            .password_expires_at
            .is_none_or(|at| at <= chrono::Utc::now().timestamp());
        let credential_available = credential_entry(&settings)
            .and_then(|entry| {
                entry
                    .get_password()
                    .map_err(|_| "credential_store_unavailable".to_string())
            })
            .is_ok();
        settings.password_needs_entry = expired || !credential_available;
    } else {
        settings.password_needs_entry = true;
    }
    Ok(settings)
}

#[tauri::command]
fn connect_device(
    input: ConnectInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ConnectionResult, String> {
    validate_input(&input)?;
    state.stream_manager.stop_all();
    settings::save_device(&state.db, &input)?;
    if input.remember_password {
        let entry = credential_entry_for(&input.host, input.port, &input.username)?;
        entry
            .set_password(&input.password)
            .map_err(|_| "credential_store_unavailable".to_string())?;
        settings::set_password_expiry(
            &state.db,
            chrono::Utc::now().timestamp() + 30 * 24 * 60 * 60,
        )?;
    } else {
        let _ = credential_entry_for(&input.host, input.port, &input.username)
            .and_then(|entry| entry.delete_credential().map_err(|error| error.to_string()));
        settings::set_password_expiry(&state.db, 0)?;
    }
    {
        let mut credentials = state
            .active_credentials
            .lock()
            .map_err(|_| "internal_error".to_string())?;
        *credentials = Some(ActiveCredentials {
            host: input.host.clone(),
            port: input.port,
            username: input.username.clone(),
            password: input.password.clone(),
        });
    }
    let cameras = settings::load(&state.db)?.cameras;
    start_cameras(
        &state,
        &input.host,
        input.port,
        &input.username,
        &input.password,
        &cameras,
    );
    let mut settings = settings::load(&state.db)?;
    settings.password_needs_entry = false;
    Ok(ConnectionResult {
        settings,
        stream_port: state.stream_port,
    })
}

#[tauri::command]
fn reconnect_saved(state: tauri::State<'_, Arc<AppState>>) -> Result<ReconnectResult, String> {
    state.stream_manager.stop_all();
    let settings = settings::load(&state.db)?;
    if !settings.configured || !settings.remember_password {
        return Err("password_expired".to_string());
    }
    if settings
        .password_expires_at
        .is_none_or(|at| at <= chrono::Utc::now().timestamp())
    {
        return Err("password_expired".to_string());
    }
    let password = credential_entry(&settings)
        .and_then(|entry| {
            entry
                .get_password()
                .map_err(|_| "password_expired".to_string())
        })
        .map_err(|_| "password_expired".to_string())?;
    {
        let mut credentials = state
            .active_credentials
            .lock()
            .map_err(|_| "internal_error".to_string())?;
        *credentials = Some(ActiveCredentials {
            host: settings.host.clone().unwrap_or_default(),
            port: settings.port,
            username: settings.username.clone().unwrap_or_default(),
            password: password.clone(),
        });
    }
    if let (Some(host), Some(username)) = (settings.host.clone(), settings.username.clone()) {
        start_cameras(
            &state,
            &host,
            settings.port,
            &username,
            &password,
            &settings.cameras,
        );
    }
    Ok(ReconnectResult {
        cameras: settings.cameras,
        stream_port: state.stream_port,
    })
}

#[tauri::command]
fn retry_connection(state: tauri::State<'_, Arc<AppState>>) -> Result<ReconnectResult, String> {
    let credentials = state
        .active_credentials
        .lock()
        .map_err(|_| "internal_error".to_string())?
        .clone()
        .ok_or_else(|| "password_expired".to_string())?;
    let settings = settings::load(&state.db)?;
    state.stream_manager.stop_all();
    start_cameras(
        &state,
        &credentials.host,
        credentials.port,
        &credentials.username,
        &credentials.password,
        &settings.cameras,
    );
    Ok(ReconnectResult {
        cameras: settings.cameras,
        stream_port: state.stream_port,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PictureInPictureState {
    camera: CameraPreference,
    stream_port: u16,
    access_key: Option<String>,
    status: String,
}

#[tauri::command]
async fn open_picture_in_picture(
    channel: u8,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if !(1..=4).contains(&channel) {
        return Err("invalid_channel".into());
    }
    let camera = settings::load(&state.db)?
        .cameras
        .into_iter()
        .find(|camera| camera.channel == channel)
        .ok_or_else(|| "invalid_channel".to_string())?;
    let key = state
        .stream_manager
        .session_access_key()
        .ok_or_else(|| "stream_not_authenticated".to_string())?;
    if !state.stream_manager.is_authorized(&key) {
        return Err("stream_not_authenticated".into());
    }
    *state
        .pip_channel
        .lock()
        .map_err(|_| "pip_state_unavailable")? = Some(channel);
    let title = format!("{} - Picture-in-Picture", camera.label);
    if let Some(window) = app.get_webview_window("pip") {
        window.set_title(&title).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "pip",
            tauri::WebviewUrl::App("index.html?window=pip".into()),
        )
        .title(&title)
        .inner_size(480.0, 270.0)
        .resizable(true)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn picture_in_picture_state(
    state: tauri::State<'_, Arc<AppState>>,
) -> Option<PictureInPictureState> {
    let channel = state.pip_channel.lock().ok().and_then(|channel| *channel)?;
    let camera = settings::load(&state.db)
        .ok()?
        .cameras
        .into_iter()
        .find(|camera| camera.channel == channel)?;
    let status = state
        .stream_manager
        .statuses()
        .into_iter()
        .find(|status| status.channel == channel)?
        .state;
    Some(PictureInPictureState {
        camera,
        stream_port: state.stream_port,
        access_key: state.stream_manager.session_access_key(),
        status,
    })
}

#[tauri::command]
fn stream_statuses(state: tauri::State<'_, Arc<AppState>>) -> Vec<StreamStatus> {
    state.stream_manager.statuses()
}

#[tauri::command]
fn stream_access_key(state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    state
        .stream_manager
        .session_access_key()
        .ok_or_else(|| "stream_not_authenticated".to_string())
}

#[tauri::command]
fn save_camera_order(order: Vec<u8>, state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if order.len() != 4 || (1..=4).any(|channel| !order.contains(&channel)) {
        return Err("invalid_camera_order".to_string());
    }
    settings::save_order(&state.db, &order)
}

#[tauri::command]
fn set_channel_stream(
    update: StreamUpdate,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if !(1..=4).contains(&update.channel) {
        return Err("invalid_channel".to_string());
    }
    settings::save_stream(&state.db, update.channel, update.stream)?;
    let credentials = state
        .active_credentials
        .lock()
        .map_err(|_| "internal_error".to_string())?
        .clone()
        .ok_or_else(|| "password_expired".to_string())?;
    let uri = stream_uri(&credentials, update.channel, update.stream)?;
    state.stream_manager.start(
        update.channel,
        &uri,
        &credentials.username,
        &credentials.password,
    )
}

#[tauri::command]
fn disconnect(app: tauri::AppHandle, state: tauri::State<'_, Arc<AppState>>) {
    if let Some(window) = app.get_webview_window("pip") {
        let _ = window.close();
    }
    state.stream_manager.stop_all();
    if let Ok(mut credentials) = state.active_credentials.lock() {
        *credentials = None;
    }
}

fn validate_input(input: &ConnectInput) -> Result<(), String> {
    if input.host.trim().is_empty() || input.username.trim().is_empty() || input.password.is_empty()
    {
        return Err("Enter the recorder address, username, and password.".to_string());
    }
    if input.port == 0 {
        return Err("Enter a valid RTSP port.".to_string());
    }
    Ok(())
}

fn credential_entry(settings: &AppSettings) -> Result<keyring::Entry, String> {
    credential_entry_for(
        settings
            .host
            .as_deref()
            .ok_or_else(|| "not_configured".to_string())?,
        settings.port,
        settings
            .username
            .as_deref()
            .ok_or_else(|| "not_configured".to_string())?,
    )
}

fn credential_entry_for(host: &str, port: u16, username: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("local-cam-viewer", &format!("{host}:{port}:{username}"))
        .map_err(|_| "credential_store_unavailable".to_string())
}

fn start_cameras(
    state: &AppState,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    cameras: &[CameraPreference],
) {
    for camera in cameras {
        let credentials = ActiveCredentials {
            host: host.to_string(),
            port,
            username: username.to_string(),
            password: password.to_string(),
        };
        match stream_uri(&credentials, camera.channel, camera.stream) {
            Ok(uri) => {
                let _ = state
                    .stream_manager
                    .start(camera.channel, &uri, username, password);
            }
            Err(error) => state.stream_manager.set_error(camera.channel, error),
        }
    }
}

fn stream_uri(
    credentials: &ActiveCredentials,
    channel: u8,
    stream: StreamKind,
) -> Result<String, String> {
    let subtype = match stream {
        StreamKind::Main => 0,
        StreamKind::Sub => 1,
    };
    let raw = format!(
        "rtsp://{}:{}/cam/realmonitor?channel={channel}&subtype={subtype}",
        credentials.host, credentials.port
    );
    let url = url::Url::parse(&raw).map_err(|_| "invalid_recorder_address".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("invalid_recorder_address".to_string());
    }
    Ok(url.to_string())
}

fn is_allowed_app_origin(origin: &str) -> bool {
    let is_production_origin = matches!(origin, "tauri://localhost" | "http://tauri.localhost");
    #[cfg(debug_assertions)]
    let is_development_origin = matches!(origin, "http://localhost:1420" | "http://127.0.0.1:1420");
    #[cfg(not(debug_assertions))]
    let is_development_origin = false;
    is_production_origin || is_development_origin
}

fn with_cors_origin(mut response: Response<Body>, origin: Option<&HeaderValue>) -> Response<Body> {
    if let Some(origin) = origin {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response
}

fn empty_response(status: StatusCode, origin: Option<&HeaderValue>) -> Response<Body> {
    with_cors_origin(
        Response::builder()
            .status(status)
            .body(Body::empty())
            .unwrap(),
        origin,
    )
}

async fn mjpeg_preflight(headers: HeaderMap) -> Response<Body> {
    let origin = headers.get(header::ORIGIN);
    let Some(origin_value) = origin.and_then(|value| value.to_str().ok()) else {
        return empty_response(StatusCode::FORBIDDEN, None);
    };
    if !is_allowed_app_origin(origin_value) {
        return empty_response(StatusCode::FORBIDDEN, None);
    }

    let requested_method = headers
        .get(header::ACCESS_CONTROL_REQUEST_METHOD)
        .and_then(|value| value.to_str().ok());
    let requested_headers = headers
        .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let only_authorization = requested_headers
        .split(',')
        .map(str::trim)
        .all(|name| name.eq_ignore_ascii_case("authorization"));
    if requested_method != Some("GET") || !only_authorization {
        return empty_response(StatusCode::FORBIDDEN, origin);
    }

    let mut response = empty_response(StatusCode::NO_CONTENT, origin);
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Authorization"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    response
}

async fn mjpeg_stream(
    State(manager): State<Arc<StreamManager>>,
    Path(channel): Path<u8>,
    headers: HeaderMap,
) -> Response<Body> {
    let origin = headers.get(header::ORIGIN);
    if let Some(origin) = origin {
        if !origin.to_str().is_ok_and(is_allowed_app_origin) {
            return empty_response(StatusCode::FORBIDDEN, None);
        }
    }
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if !bearer.is_some_and(|candidate| manager.is_authorized(candidate)) {
        return empty_response(StatusCode::UNAUTHORIZED, origin);
    }
    let Some(mut receiver) = manager.subscribe(channel) else {
        return empty_response(StatusCode::NOT_FOUND, origin);
    };
    let stream = async_stream::stream! {
        loop {
            let frame = match receiver.recv().await {
                Ok(frame) => frame,
                // A slow browser can fall behind the one-frame live buffer.
                // Tokio advances the receiver; keep streaming from the next frame.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };
            let prefix = format!("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n", frame.len());
            yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(prefix));
            yield Ok(Bytes::from(frame));
            yield Ok(Bytes::from_static(b"\r\n"));
        }
    };
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "multipart/x-mixed-replace; boundary=frame",
        )
        .header(header::CACHE_CONTROL, "no-store, no-cache, must-revalidate")
        .body(Body::from_stream(stream))
        .unwrap();
    with_cors_origin(response, origin)
}

fn start_stream_server(manager: Arc<StreamManager>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let listener = tauri::async_runtime::block_on(async { TokioListener::from_std(listener) })
        .map_err(|error| error.to_string())?;
    let app = Router::new()
        .route(
            "/stream/{channel}",
            get(mjpeg_stream).options(mjpeg_preflight),
        )
        .with_state(manager);
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok(port)
}

fn open_database(data_dir: &PathBuf) -> Result<Connection, String> {
    std::fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let connection =
        Connection::open(data_dir.join("settings.sqlite")).map_err(|error| error.to_string())?;
    settings::initialize(&connection)?;
    Ok(connection)
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let connection = open_database(&data_dir).map_err(std::io::Error::other)?;
            let stream_manager = Arc::new(StreamManager::new());
            let stream_port =
                start_stream_server(stream_manager.clone()).map_err(std::io::Error::other)?;
            app.manage(Arc::new(AppState {
                db: Mutex::new(connection),
                stream_manager,
                stream_port,
                active_credentials: Mutex::new(None),
                pip_channel: Mutex::new(None),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            connect_device,
            reconnect_saved,
            retry_connection,
            stream_statuses,
            open_picture_in_picture,
            picture_in_picture_state,
            stream_access_key,
            save_camera_order,
            set_channel_stream,
            disconnect,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Local Cam");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                state.stream_manager.stop_all();
                if let Ok(mut credentials) = state.active_credentials.lock() {
                    *credentials = None;
                }
            }
        }
    });
}
