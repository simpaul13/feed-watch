# Product

<!-- impeccable:product-schema 1 -->

## Platform

Desktop

## Stack

Tauri 2 with React/TypeScript and Rust. The exploratory prototype uses GStreamer for RTSP playback; the production playback path is still under evaluation.

## Users

The primary user is the owner/operator of one Dahua DH-XVR1B04-I recorder on a local network, using a Windows or Linux computer.

## Product Purpose

Provide a dedicated desktop application that opens directly into the user's live camera view, replacing the repeated browser login and browser plug-in workflow. Success means the user can launch the app, reconnect to the saved recorder, and view available channels without opening a browser.

## Positioning

A small personal viewer configured around the user's existing recorder and local network, leaving recording and device administration to the NVR/DVR.

## Operating Context

The app runs on Windows and Linux on the same LAN as the recorder. On first use, the user enters its IP address and login. Later launches reconnect automatically when saved credentials are available. The user wants a four-tile Live view, camera ordering, and per-camera Main Stream or Sub Stream 1 selection.

## Capabilities and Constraints

- Target the current four-channel Dahua DH-XVR1B04-I first; broad recorder support is not required for the first working version.
- The user verified all four channels playing over RTSP in VLC outside the browser. Main/Sub coverage should be confirmed in the app playback path.
- Use a four-tile default; Sub Stream 1 is the grid default, and Main Stream is the full-screen default. Let the user choose either stream.
- Keep unavailable/offline tiles black and show separate connection status.
- Store IP and non-secret preferences in a local SQLite database. Store a password only when “Remember password” is selected, using the operating system credential store; require manual re-entry after 30 days.
- No cloud configuration or remote telemetry.
- Windows and Linux are target operating systems. The exact Linux distribution and packaging dependencies remain open.
- Out of scope for the first viewer: recording, recorded playback, talk, PTZ, alarms, recorder configuration, and video analytics.

## Product Principles

- Open directly into the user's live view.
- Keep recorder communication on the local network.
- Keep credentials separate from SQLite preferences.
- Keep the first release focused on viewing the current device.

## Evidence on Hand

- The recorder's Version screen identified model DH-XVR1B04-I, hardware V2.0, and four record channels.
- The user demonstrated live RTSP playback from all channels in VLC.
- The existing NVR Live screenshot shows the target four-tile viewing workflow and black offline tile behavior.
- Dahua's published V2.0 datasheet lists RTSP, ONVIF, and dual-stream support.
