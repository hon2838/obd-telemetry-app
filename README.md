# OBD2 Telemetry & Dashboard

A comprehensive vehicle telemetry solution designed specifically for a Perodua Axia running on an Android 10 (API 29) FYT 7862S Head Unit. 

This system consists of a headless Android background service that continuously polls engine data via a Bluetooth ELM327 OBD2 adapter, stores it locally, and syncs it periodically to a Node.js backend. A modern Next.js web dashboard is provided to monitor the telemetry data in real time, view historical drives, and issue diagnostic commands.

## Features

- **Robust Automotive Lifecycle:** Automatically starts the background service when the Android head unit boots.
- **Resilient Connectivity:** Implements exponential backoff to handle Bluetooth socket drops and gracefully reconnect to the OBD2 adapter.
- **Offline Storage & Batch Sync:** 
  - Data is logged locally to a Room/SQLite database.
  - A periodic 60-second sync loop checks for internet connectivity.
  - If offline, data safely accumulates locally.
  - When reconnected, all offline data is batch-uploaded to the server, preserving battery and preventing data loss.
- **Diagnostics (DTC):** Supports queuing Mode 03 (Read) and Mode 04 (Clear) Diagnostic Trouble Code commands directly from the web dashboard.
- **Data Export:** Easily export drive sessions to CSV for analysis or GPX for mapping and video overlays (e.g., Strava, RaceRender).
- **Smart Alerts:** Monitors and logs critical warnings, such as coolant temperatures exceeding 105°C or battery voltage dropping below 11.8V.
- **Performance Tracking:** Automatically tracks and logs 0-100 km/h acceleration sprint times.
- **Modern Web Dashboard:** A rich, aesthetically pleasing Next.js dashboard using Recharts for data visualization.

## Architecture & Components

The repository is divided into three main components:

1. **`AndroidApp/` (Kotlin):** 
   - The Android client running on the head unit.
   - Requires `FOREGROUND_SERVICE` and `ACCESS_BACKGROUND_LOCATION`.
   - Uses `kotlin-obd-api` for ELM327 communication.
2. **`Server/` (Node.js / Fastify):** 
   - A lightweight, high-performance API server.
   - Handles batch ingestion of telemetry data and queues diagnostic commands.
3. **`Dashboard/` (Next.js):**
   - The frontend monitoring interface.

## Getting Started

### Android App
1. Open `AndroidApp` in Android Studio.
2. Build and install the APK on your Android 10 Head Unit.
3. Pair your ELM327 Bluetooth adapter with the head unit.
4. Launch the app, select the adapter, configure your API endpoint, and start the service.

### Backend Server
1. Navigate to the `Server` directory.
2. Run `npm install`.
3. Run `node server.js` (The server runs on port 3000 by default).

### Web Dashboard
1. Navigate to the `Dashboard` directory.
2. Run `npm install`.
3. Run `npm run dev` to start the development server.
4. Access the dashboard via your browser.

## Tech Stack

- **Android:** Kotlin, Room, Coroutines, Foreground Services
- **Backend:** Node.js, Fastify
- **Frontend:** Next.js, React, Recharts, CSS Modules
