# Privacy Policy

## Introduction

**MarkerOn** is a lightweight desktop screen annotation tool. We highly value your privacy, and this policy explains how we handle your data.

## Data Collection and Usage

### Information We Do **Not** Collect

MarkerOn explicitly commits to:

* **Not** creating any unique identifiers, trackers, or similar tools
* **Not** collecting usage statistics, performance metrics, or any user behavior information
* **Not** uploading annotations, screenshots, or personal data to remote servers
* **Not** incorporating advertisements or analytics tools
* **Not** selling or sharing your personal data with third parties

### Locally Stored Data

MarkerOn only saves the following information locally:

1. **Configuration Data**
   Shortcut keys, general preferences (e.g. auto-start, drag mode), and related settings.
   - **Installed builds**: stored in the Tauri / OS application data directory (for example AppData on Windows).
   - **Portable builds**: stored under a `data\` folder next to the executable (not AppData).

2. **Drawing Data**
   Annotations exist only in memory during the app process and are **never** written to disk or uploaded.
   By default, exiting annotation mode clears drawings. If **Keep after exit** is enabled in Settings, drawings remain in memory until the next annotation session or until you quit the app.

### Network Access

MarkerOn does **not** send telemetry, crash reports, or user content to remote servers.

Optional network use (installer builds only, when you choose to):

* **Update checks / downloads** via the built-in updater (GitHub Releases metadata and installers), when you tap check/update in About
* **Opening links you choose** (project homepage, help, Store, and similar) through the system browser

Portable builds do not use the in-app updater; update by downloading a new zip manually.

MarkerOn is **local-first**: no account, no cloud sync of drawings. It is **not** a zero-network app when you use updates or open external links.

## Data Protection and Deletion

Configuration stays on your machine. MarkerOn does not remotely sync or upload it.
To remove config for an installed build, uninstall the app (and delete leftover config folders if your OS leaves them). For portable builds, delete the app folder including `data\`.

## Permission Usage Information

System permissions requested by MarkerOn are only used to implement core functions:

* **Display Overlay**: For rendering the transparent full-screen annotation layer on top of other windows
* **Global Shortcut Keys**: For toggling annotation mode and clearing drawings from any application
* **File System Access**: For reading and writing configuration files (and updater downloads when applicable)
* **Startup Item Modification**: Only used when the "Start with System" feature is enabled

## Privacy Policy Changes

If there are significant changes, we will post notifications on the [project homepage](https://markeron.cn/) and GitHub.

## Contact Information

If you have questions or suggestions about this privacy policy, please contact us through the [GitHub project page](https://github.com/ifer47/markeron).

> Last Updated: July 22, 2026
