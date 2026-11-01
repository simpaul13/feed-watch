use std::{collections::HashMap, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, thread, time::Duration};

use axum::body::Bytes;
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app::{AppSink, AppSinkCallbacks};
use serde::Serialize;
use tokio::sync::broadcast;

struct ActiveFeed {
    pipeline: gst::Pipeline,
    frames: broadcast::Sender<Bytes>,
    state: Arc<Mutex<String>>,
    stop_bus: Arc<AtomicBool>,
}

pub struct StreamManager {
    feeds: Mutex<HashMap<u8, ActiveFeed>>,
    last_state: Mutex<HashMap<u8, String>>,
    session_key: Arc<Mutex<Option<String>>>,
    session_active: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
pub struct StreamStatus {
    channel: u8,
    state: String,
}

impl StreamManager {
    pub fn new() -> Self {
        Self {
            feeds: Mutex::new(HashMap::new()),
            last_state: Mutex::new(HashMap::new()),
            session_key: Arc::new(Mutex::new(None)),
            session_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&self, channel: u8, uri: &str, username: &str, password: &str) -> Result<(), String> {
        self.stop(channel);
        self.session_active.store(true, Ordering::SeqCst);
        gst::init().map_err(|_| "playback_runtime_unavailable".to_string())?;

        let pipeline = gst::Pipeline::new();
        let decoder = gst::ElementFactory::make("uridecodebin")
            .property("uri", uri)
            .build().map_err(|_| "playback_runtime_missing_decoder".to_string())?;
        let source_username = username.to_string();
        let source_password = password.to_string();
        decoder.connect("source-setup", false, move |values| {
            if let Ok(source) = values[1].get::<gst::Element>() {
                let is_rtsp = source.factory().is_some_and(|factory| factory.name() == "rtspsrc");
                if is_rtsp
                    && source.find_property("user-id").is_some()
                    && source.find_property("user-pw").is_some()
                {
                    source.set_property("user-id", &source_username);
                    source.set_property("user-pw", &source_password);
                }
            }
            None
        });
        let convert = gst::ElementFactory::make("videoconvert").build().map_err(|_| "playback_runtime_missing_video_convert".to_string())?;
        let jpeg = gst::ElementFactory::make("jpegenc").property("quality", 72i32).build()
            .map_err(|_| "playback_runtime_missing_jpeg_encoder".to_string())?;
        let frames = AppSink::builder().sync(false).max_buffers(1).property("drop", true).build();
        pipeline.add_many([&decoder, &convert, &jpeg, frames.upcast_ref()])
            .map_err(|_| "playback_pipeline_setup_failed".to_string())?;
        gst::Element::link_many([&convert, &jpeg, frames.upcast_ref()])
            .map_err(|_| "playback_pipeline_link_failed".to_string())?;

        let convert_sink = convert.static_pad("sink").ok_or_else(|| "playback_video_pad_missing".to_string())?;
        decoder.connect_pad_added(move |_, source_pad| {
            let caps = source_pad.current_caps().unwrap_or_else(|| source_pad.query_caps(None));
            let is_video = caps.structure(0).map(|structure| structure.name().starts_with("video/x-raw")).unwrap_or(false);
            if is_video && !convert_sink.is_linked() {
                let _ = source_pad.link(&convert_sink);
            }
        });

        // Keep only the newest frame so slow viewers do not accumulate stale video.
        let (sender, _) = broadcast::channel(1);
        let state = Arc::new(Mutex::new("connecting".to_string()));
        let frame_sender = sender.clone();
        let frame_state = state.clone();
        let session_key = self.session_key.clone();
        let session_active = self.session_active.clone();
        frames.set_callbacks(AppSinkCallbacks::builder().new_sample(move |sink| {
            let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
            let buffer = sample.buffer().ok_or(gst::FlowError::Error)?;
            let mapped = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;
            if let Ok(mut current_key) = session_key.lock() {
                if session_active.load(Ordering::SeqCst) && current_key.is_none() {
                    let mut random = [0u8; 32];
                    if getrandom::fill(&mut random).is_ok() {
                        const HEX: &[u8; 16] = b"0123456789abcdef";
                        let mut encoded = String::with_capacity(64);
                        for byte in random {
                            encoded.push(HEX[(byte >> 4) as usize] as char);
                            encoded.push(HEX[(byte & 0x0f) as usize] as char);
                        }
                        *current_key = Some(encoded);
                    }
                }
            }
            let _ = frame_sender.send(Bytes::copy_from_slice(mapped.as_slice()));
            if let Ok(mut current) = frame_state.lock() { *current = "live".to_string(); }
            Ok(gst::FlowSuccess::Ok)
        }).build());

        pipeline.set_state(gst::State::Playing).map_err(|_| "recorder_unreachable".to_string())?;
        if let Ok(mut states) = self.last_state.lock() { states.insert(channel, "connecting".to_string()); }

        let stop_bus = Arc::new(AtomicBool::new(false));
        if let Some(bus) = pipeline.bus() {
            let bus_stop = stop_bus.clone();
            let bus_state = state.clone();
            thread::spawn(move || {
                while !bus_stop.load(Ordering::Relaxed) {
                    if let Some(message) = bus.timed_pop(gst::ClockTime::from_seconds(1)) {
                        match message.view() {
                            gst::MessageView::Error(error) => {
                                let detail = error.error().to_string().to_lowercase();
                                let next = if detail.contains("401") || detail.contains("unauthorized") || detail.contains("authentication") { "authentication_failed" } else { "offline" };
                                if let Ok(mut current) = bus_state.lock() { *current = next.to_string(); }
                                break;
                            }
                            gst::MessageView::Eos(..) => {
                                if let Ok(mut current) = bus_state.lock() { *current = "offline".to_string(); }
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            });
        }

        let feed = ActiveFeed { pipeline, frames: sender, state, stop_bus };
        self.feeds.lock().map_err(|_| "playback_internal_error".to_string())?.insert(channel, feed);
        Ok(())
    }

    pub fn subscribe(&self, channel: u8) -> Option<broadcast::Receiver<Bytes>> {
        self.feeds.lock().ok()?.get(&channel).map(|feed| feed.frames.subscribe())
    }

    pub fn session_access_key(&self) -> Option<String> {
        self.session_key.lock().ok()?.clone()
    }

    pub fn is_authorized(&self, candidate: &str) -> bool {
        use subtle::ConstantTimeEq;

        let Ok(key) = self.session_key.lock() else { return false };
        let Some(key) = key.as_deref() else { return false };
        key.len() == candidate.len() && bool::from(key.as_bytes().ct_eq(candidate.as_bytes()))
    }

    pub fn revoke_session(&self) {
        if let Ok(mut key) = self.session_key.lock() { *key = None; }
    }

    pub fn statuses(&self) -> Vec<StreamStatus> {
        let feeds = self.feeds.lock().ok();
        let mut statuses = Vec::with_capacity(4);
        for channel in 1..=4u8 {
            let state = feeds.as_ref().and_then(|map| map.get(&channel)).and_then(|feed| feed.state.lock().ok().map(|state| state.clone()))
                .or_else(|| self.last_state.lock().ok().and_then(|state| state.get(&channel).cloned()))
                .unwrap_or_else(|| "offline".to_string());
            statuses.push(StreamStatus { channel, state });
        }
        statuses
    }

    pub fn set_error(&self, channel: u8, error: String) {
        let state = if error.contains("authentication") { "authentication_failed" } else { "error" };
        if let Ok(mut states) = self.last_state.lock() { states.insert(channel, state.to_string()); }
    }

    pub fn stop(&self, channel: u8) {
        let feed = self.feeds.lock().ok().and_then(|mut feeds| feeds.remove(&channel));
        if let Some(feed) = feed {
            feed.stop_bus.store(true, Ordering::Relaxed);
            let _ = feed.pipeline.set_state(gst::State::Null);
            if let Ok(mut states) = self.last_state.lock() { states.insert(channel, "offline".to_string()); }
        }
    }

    pub fn stop_all(&self) {
        self.session_active.store(false, Ordering::SeqCst);
        self.revoke_session();
        let channels = self.feeds.lock().ok().map(|feeds| feeds.keys().copied().collect::<Vec<_>>()).unwrap_or_default();
        for channel in channels { self.stop(channel); }
        thread::sleep(Duration::from_millis(10));
    }
}

impl Drop for StreamManager {
    fn drop(&mut self) {
        if let Ok(feeds) = self.feeds.get_mut() {
            for (_, feed) in feeds.drain() {
                feed.stop_bus.store(true, Ordering::Relaxed);
                let _ = feed.pipeline.set_state(gst::State::Null);
            }
        }
    }
}
