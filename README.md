# Local Cam

Local Cam is a desktop application for viewing live video from a recorder on the same local network. Its first compatibility target is the four-channel Dahua DH-XVR1B04-I. Support for other recorder brands and models has not been established.

The project is an early prototype for Windows and Linux. Playback is still being evaluated, so verify it with your platform and recorder before relying on it.

## Features

- Four-tile live camera view
- Configurable camera order and per-camera Main Stream or Sub Stream 1 selection
- Local recorder connection settings
- Optional password remembering

## Getting started

### Requirements

To develop or build the desktop application, install:

- Node.js and npm
- Rust and Cargo with the native toolchain required by Tauri for your operating system
- The Tauri system dependencies for your operating system
- GStreamer development libraries and runtime plugins compatible with your platform. Playback requires URI decoding (`uridecodebin`), an RTSP source (`rtspsrc`), a decoder for the recorder's video codec, video conversion (`videoconvert`), and JPEG encoding (`jpegenc`). These elements may come from different GStreamer plugin packages; install packages that provide all of them for your platform.

See the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [GStreamer installation guide](https://gstreamer.freedesktop.org/documentation/installing/) for platform-specific instructions. Native dependencies and packaging steps vary by operating system.

### Install and run

From the project directory, install frontend dependencies and start the desktop development app:

```sh
npm install
npm run tauri dev
```

To run only the browser-based interface during UI development:

```sh
npm run dev
```

The browser preview does not provide the native Tauri backend used for recorder connections.

### Build

Build the frontend bundle and run TypeScript checks:

```sh
npm run build
```

Build the desktop application and installer/package for the current platform:

```sh
npm run tauri build
```

Tauri writes build outputs under `src-tauri/target/`. Output format, runtime requirements, and packaging success depend on the host operating system and installed native dependencies. A successful build does not confirm camera authentication or video playback.

## Connect a recorder

1. Connect the computer and recorder to the same trusted local network.
2. In the app, enter the recorder address, RTSP port, username, and password.
3. Choose whether to remember the password. When enabled, it is stored in the operating system credential store and must be entered again after 30 days. Non-secret preferences are stored locally.
4. Connect and check the cameras and stream types available on your recorder. The app supports Main Stream and Sub Stream 1.

The recorder connection uses RTSP without transport encryption, so keep recorder access on a trusted local network. The app's temporary video endpoint binds to `127.0.0.1` on an available local port and requires a session key; it is not exposed as a LAN service.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/` | React and TypeScript user interface |
| `src-tauri/src/` | Rust commands, settings, credential handling, and stream processing |
| `src-tauri/` | Tauri application and build configuration |
| `docs/` | Product and design documentation |
| `PRODUCT.md` | Product goals, current scope, and constraints |

## Architecture and boundaries

- The React and TypeScript frontend owns interface state and presentation.
- The Rust and Tauri backend handles native commands, local preferences, credentials, and video processing.
- IP address and non-secret preferences are stored locally; credentials are handled separately.
- Recorder communication stays on the local network. The project has no cloud configuration or telemetry. Recording, recorded-video playback, PTZ, two-way audio, alarms, recorder administration, and video analytics are outside the current scope.

## Development checks

| Command | Purpose |
| --- | --- |
| `npm run build` | TypeScript checks and frontend production build |
| `cargo fmt --manifest-path src-tauri/Cargo.toml` | Format Rust code |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Check the Rust backend; native dependencies must be available |

There is no automated test or lint script configured at this time. Manually verify initial setup, connection errors, four-camera viewing, camera ordering, stream selection, settings, and app restart on the target platform and recorder.

## Further information

- [Product overview and constraints](PRODUCT.md)
- [Contributor and repository guidelines](AGENTS.md)
