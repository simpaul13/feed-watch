use std::sync::Mutex;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StreamKind {
    Main,
    Sub,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraPreference {
    pub channel: u8,
    pub position: usize,
    pub stream: StreamKind,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub configured: bool,
    pub host: Option<String>,
    pub port: u16,
    pub username: Option<String>,
    pub remember_password: bool,
    pub password_needs_entry: bool,
    pub password_expires_at: Option<i64>,
    pub camera_order: Vec<u8>,
    pub cameras: Vec<CameraPreference>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectInput {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub remember_password: bool,
    pub cameras: Vec<CameraPreference>,
}

pub fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS device_settings (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           host TEXT NOT NULL,
           port INTEGER NOT NULL DEFAULT 554,
           username TEXT NOT NULL,
           remember_password INTEGER NOT NULL DEFAULT 0,
           password_expires_at INTEGER
         );
         CREATE TABLE IF NOT EXISTS camera_preferences (
           channel INTEGER PRIMARY KEY CHECK (channel BETWEEN 1 AND 4),
           position INTEGER NOT NULL,
           stream TEXT NOT NULL DEFAULT 'sub',
           label TEXT NOT NULL
         );",
        )
        .map_err(|error| error.to_string())?;
    for channel in 1..=4u8 {
        connection.execute(
            "INSERT OR IGNORE INTO camera_preferences (channel, position, stream, label) VALUES (?1, ?2, 'sub', ?3)",
            params![i64::from(channel), i64::from(channel - 1), format!("Channel {channel}")],
        ).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn load(db: &Mutex<Connection>) -> Result<AppSettings, String> {
    let connection = db.lock().map_err(|_| "database_error".to_string())?;
    let row = connection.query_row(
        "SELECT host, port, username, remember_password, password_expires_at FROM device_settings WHERE id = 1",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u16, row.get::<_, String>(2)?, row.get::<_, bool>(3)?, row.get::<_, Option<i64>>(4)?)),
    );
    let (host, port, username, remember_password, password_expires_at) = match row {
        Ok(values) => (Some(values.0), values.1, Some(values.2), values.3, values.4),
        Err(rusqlite::Error::QueryReturnedNoRows) => (None, 554, None, false, None),
        Err(error) => return Err(error.to_string()),
    };
    let mut statement = connection
        .prepare(
            "SELECT channel, position, stream, label FROM camera_preferences ORDER BY position",
        )
        .map_err(|error| error.to_string())?;
    let cameras = statement
        .query_map([], |row| {
            let stream = match row.get::<_, String>(2)?.as_str() {
                "main" => StreamKind::Main,
                _ => StreamKind::Sub,
            };
            Ok(CameraPreference {
                channel: row.get(0)?,
                position: row.get::<_, i64>(1)? as usize,
                stream,
                label: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let camera_order = cameras.iter().map(|camera| camera.channel).collect();
    Ok(AppSettings {
        configured: host.is_some(),
        host,
        port,
        username,
        remember_password,
        password_needs_entry: true,
        password_expires_at,
        camera_order,
        cameras,
    })
}

pub fn save_device(db: &Mutex<Connection>, input: &ConnectInput) -> Result<(), String> {
    let mut connection = db.lock().map_err(|_| "database_error".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO device_settings (id, host, port, username, remember_password, password_expires_at)
         VALUES (1, ?1, ?2, ?3, ?4, NULL)
         ON CONFLICT(id) DO UPDATE SET host=excluded.host, port=excluded.port, username=excluded.username, remember_password=excluded.remember_password, password_expires_at=NULL",
        params![input.host.trim(), i64::from(input.port), input.username.trim(), input.remember_password],
    ).map_err(|error| error.to_string())?;
    for camera in &input.cameras {
        transaction
            .execute(
                "UPDATE camera_preferences SET position=?1, stream=?2, label=?3 WHERE channel=?4",
                params![
                    camera.position as i64,
                    stream_text(camera.stream),
                    camera.label,
                    i64::from(camera.channel)
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub fn set_password_expiry(db: &Mutex<Connection>, expires_at: i64) -> Result<(), String> {
    db.lock()
        .map_err(|_| "database_error".to_string())?
        .execute(
            "UPDATE device_settings SET password_expires_at=?1 WHERE id=1",
            [expires_at],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn save_order(db: &Mutex<Connection>, order: &[u8]) -> Result<(), String> {
    let mut connection = db.lock().map_err(|_| "database_error".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (position, channel) in order.iter().enumerate() {
        transaction
            .execute(
                "UPDATE camera_preferences SET position=?1 WHERE channel=?2",
                params![position as i64, i64::from(*channel)],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub fn save_stream(db: &Mutex<Connection>, channel: u8, stream: StreamKind) -> Result<(), String> {
    db.lock()
        .map_err(|_| "database_error".to_string())?
        .execute(
            "UPDATE camera_preferences SET stream=?1 WHERE channel=?2",
            params![stream_text(stream), i64::from(channel)],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn stream_text(stream: StreamKind) -> &'static str {
    match stream {
        StreamKind::Main => "main",
        StreamKind::Sub => "sub",
    }
}
