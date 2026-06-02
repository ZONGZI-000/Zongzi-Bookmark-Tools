# 🎋 Zongzi Bookmark Tools

> A Chrome/Chromium extension for bookmark management: search, summarize, sync, backup, and clean — all in one place.

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](#)
[![Manifest](https://img.shields.io/badge/manifest-v3-green)](#)
[![License](https://img.shields.io/badge/license-MIT-orange)](#)
[![Beta](https://img.shields.io/badge/release-v0.1.0--beta-yellow)](https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools/releases/tag/v0.1.0-beta)

[中文](README.md) | [GitHub](https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools)

---

## 📖 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Usage](#-usage)
  - [Bookmark Search](#1-bookmark-search)
  - [Bookmark Summary](#2-bookmark-summary)
  - [Bookmark Sync](#3-bookmark-sync)
  - [Bookmark Cleanup](#4-bookmark-cleanup)
- [Sync Backends](#-sync-backends)
- [Permissions](#-permissions)
- [FAQ](#-faq)
- [Development](#-development)

---

## ✨ Features

### 🔍 Bookmark Search
- Open popup to instantly search local bookmarks by title, URL, or folder path

### 🤖 Bookmark Summary
- Automatically generate summaries and keywords using multiple AI engines
- Engine options: TextRank offline / Local ONNX model / Chrome Gemini Nano / Custom OpenAI / Custom Anthropic
- Local model supports one-click folder import — no network download needed

### 🔄 Bookmark Sync
- 4 sync backends with full folder structure preservation
- Smart Sync: automatically detects change direction to avoid conflicts
- Safe mode (default): download never overwrites local bookmarks
- Full mirror mode: remote structure replaces local completely
- Auto sync: scheduled automatic backup

### 🧹 Bookmark Cleanup
- Duplicate cleanup: deduplicate by URL, prioritize bookmark bar copies
- Empty folder cleanup: recursively remove folders with no bookmarks
- Invalid bookmark scanner: detect 404, 403, 5xx, timeout, and broken links
- Confidence tiers: high (red) / medium (orange) / low (gray) for quick judgment
- Pause/resume, multi-select, filter by type, selective deletion

### 🌐 More Highlights
- Bilingual UI (Chinese/English), switch from popup panel
- Sensitive data (passwords, tokens, API keys) encrypted locally
- Error messages automatically sanitized to prevent key leakage

---

## 📥 Installation

### Chrome / Edge / Brave / Doubao and other Chromium browsers

1. Open your browser and go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the extension folder
5. Done — the toolbar icon will appear

### Download from GitHub

```bash
git clone https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools.git
```

Or download the latest ZIP from [Releases](https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools/releases).

---

## 📘 Usage

After installation, click the toolbar icon to open the popup panel.

### 1. Bookmark Search

| Action | Description |
|---|---|
| Type keywords | Search local bookmarks by title, URL, or folder path |
| Click result | Open the bookmark in a new tab |

### 2. Bookmark Summary

| Action | Description |
|---|---|
| Select engine | Choose an AI engine in Settings → Summary Engine |
| Import local model | Download the ONNX folder from a mirror site → click "Import folder" |
| Auto index | When enabled, new bookmarks get auto-summarized |

**Local Model Import Steps:**

> 1. Open [HuggingFace](https://huggingface.co/Xenova/LaMini-Flan-T5-783M) / [hf-mirror](https://hf-mirror.com/Xenova/LaMini-Flan-T5-783M) / [ModelScope](https://modelscope.cn/models/Xenova/LaMini-Flan-T5-783M/files)
> 2. Download the full model folder (includes `onnx/` subdirectory + 5 files total)
> 3. In Settings, click **Select model folder to import**
> 4. Choose the downloaded folder — import completes automatically

### 3. Bookmark Sync

| Backend | Buttons | Description |
|---|---|---|
| Local file | Export / Import | Manual JSON backup/restore, no network needed |
| WebDAV | Smart Sync / Upload / Download | Sync via WebDAV server |
| GitHub | Smart Sync / Upload / Download | Sync via GitHub repository |
| Gitee | Smart Sync / Upload / Download | Sync via Gitee repository |

**Download Modes:**

| Mode | Behavior |
|---|---|
| 🔒 Safe mode (default) | Remote content imported to isolated folder, local bookmarks untouched |
| 🪞 Full mirror mode | Remote structure replaces local bookmark roots directly |

### 4. Bookmark Cleanup

| Button | Description |
|---|---|
| Clean all | Run duplicate + empty folder cleanup at once |
| Clean duplicates | Remove duplicate URLs, keep bookmark bar copies |
| Clean empty folders | Recursively remove empty folders |
| Scan invalid | Open dedicated page to scan and selectively delete broken links |

**Invalid Bookmark Scanner:**

| Feature | Description |
|---|---|
| Timeout config | Customize request timeout (default 15s) |
| Pause/Resume | Pause and resume scanning at any time |
| Confidence tiers | 🔴 High: Page not found (404) / 🟠 Medium: Timeout, network error, server error / ⚪ Low: Access denied, certificate risk |
| Type filter | Real-time filter and select by issue type |
| Select all/multi | Full select, type-based select, manual check |
| Delete confirm | Batch delete selected items, works even when paused |

---

## 🔌 Sync Backends

### Local File (Default)
- No network setup required, works out of the box
- Export: save current bookmarks as a JSON file
- Import: restore bookmarks from a JSON file

### WebDAV

| Setting | Description |
|---|---|
| Folder URL | WebDAV directory URL, e.g. `https://example.com/remote.php/dav/files/USER/bookmarks/` |
| Username | WebDAV account |
| Password/Token | Use an app-specific password instead of account password |
| Remote filename | JSON filename for sync, default `chrome-bookmarks.json` |
| Request timeout | Network timeout in seconds (default 30s) |

Examples:
- Nextcloud: `https://example.com/remote.php/dav/files/YOUR_USER/bookmarks/`
- Synology NAS: `https://example.com:5006/bookmarks/`

### GitHub / Gitee

| Setting | Description |
|---|---|
| Token | Personal Access Token (repo scope required) |
| Owner/Org | Account or organization that owns the repo |
| Repository | Target repository name |
| Branch | Target branch (default main) |
| File path | Path to the JSON sync file in the repo |

---

## 🔐 Permissions

| Permission | Purpose |
|---|---|
| `bookmarks` | Read/write bookmarks |
| `storage` | Save settings, encrypted credentials, sync state |
| `unlimitedStorage` | Store local AI model files (~370 MB) |
| `alarms` | Scheduled auto sync & cleanup |
| `notifications` | Sync failure alerts |
| `downloads` | Export local JSON backup files |
| `tabs` / `scripting` | Broken bookmark error page diagnosis |
| `offscreen` | Local AI model inference |
| `host_permissions` | Access sync backends and scan bookmark URLs |

---

## ❓ FAQ

<details>
<summary><b>What's the difference between safe mode and mirror mode?</b></summary>

- **Safe mode**: downloaded bookmarks go into an isolated folder, your existing bookmarks stay untouched.
- **Mirror mode**: remote structure **fully replaces** local bookmark roots — local originals will be deleted.
</details>

<details>
<summary><b>What's the difference between Smart Sync and Upload/Download?</b></summary>

- **Smart Sync**: automatically picks upload or download based on which side changed. Stops on conflict.
- **Upload**: force local → remote.
- **Download**: force remote → local.
</details>

<details>
<summary><b>What do the confidence colors mean in the scanner?</b></summary>

| Color | Confidence | Meaning |
|---|---|---|
| 🔴 Red | High | Clearly broken (404), safe to delete |
| 🟠 Orange | Medium | Possibly broken (timeout, server error), review first |
| ⚪ Gray | Low | Likely not broken (403, rate limit, cert issue), manual judgment needed |
</details>

<details>
<summary><b>My bookmarks disappeared. What should I do?</b></summary>

1. Check if you accidentally used **mirror mode** — it replaces local bookmarks
2. Check if an empty snapshot was uploaded to WebDAV / GitHub / Gitee
3. If you have a local JSON backup, use "Import File" to restore
4. If the remote has a good version, use "Download" to restore
</details>

<details>
<summary><b>Does it work with Doubao Browser?</b></summary>

Yes. Doubao Browser is Chromium-based and supports Chrome MV3 extensions. We've added compatibility fixes for duplicate function declarations and Service Worker loading failures.
</details>

<details>
<summary><b>WebDAV connection fails. What to do?</b></summary>

1. Verify the WebDAV URL is accessible in the browser
2. Check username/password correctness
3. Use app-specific passwords (e.g., Nextcloud requires generating one in settings)
4. Increase timeout (e.g., 60s) for proxy/slow networks
5. Click "Test WebDAV" to see the specific error
</details>

---

## 🛠 Development

### Tech Stack

| Layer | Technology |
|---|---|
| Extension framework | Chrome Manifest V3 |
| Storage | IndexedDB + chrome.storage |
| AI inference | Transformers.js + ONNX Runtime Web |
| Encryption | Web Crypto API (AES-GCM) |
| Sync | WebDAV / GitHub API / Gitee API |

### Project Structure

```
chrome-webdav-bookmark-sync/
├── manifest.json              # Extension manifest
├── background.js              # Service Worker
├── popup.html / popup.js      # Popup panel
├── options.html / options.js  # Settings page
├── invalid.html / invalid.js  # Invalid bookmark scanner
├── i18n.js                    # i18n resources
├── app-config.js              # Global config & utilities
├── offscreen-inference.js     # Local AI model inference
├── styles.css                 # Popup / settings styles
├── import-model.css           # Model import area styles
├── icons/                     # Extension icons
├── lib/                       # Third-party libs (Transformers.js)
└── models/                    # Built-in lightweight models
```

### Build & Release

This extension is pure static files with no build step. Reload the extension after code changes.

To release a new version:

```bash
# Update version in manifest.json
git add -A
git commit -m "vX.Y.Z: release notes"
git tag vX.Y.Z
git push origin main --tags
```

---

## 📄 License

MIT © ZONGZI-000

---

## 🤖 Built with AI

This project was developed and designed with the assistance of the following AI technologies:

<p align="center">
  <img src="https://avatars.githubusercontent.com/u/81847?s=64&v=4" width="40" height="40" alt="Claude" title="Claude" />
  &nbsp;
  <img src="https://avatars.githubusercontent.com/u/148330874?s=200&v=4" width="40" height="40" alt="DeepSeek" title="DeepSeek" />
  &nbsp;
  <img src="data:image/png;base64,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" width="40" height="40" alt="ChatGPT" title="ChatGPT" />
</p>

<p align="center">
  <sub>Made with ❤️ for bookmark lovers | 为书签爱好者而生</sub>
</p>
