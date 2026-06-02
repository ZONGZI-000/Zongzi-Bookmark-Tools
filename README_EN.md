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
  <img src="https://raw.githubusercontent.com/ZONGZI-000/ZONGZI-000/main/%E5%9B%BE%E5%BA%8A/chatgpt-icon.png" width="40" height="40" alt="ChatGPT" title="ChatGPT" />
</p>

<p align="center">
  <sub>Made with ❤️ for bookmark lovers | 为书签爱好者而生</sub>
</p>
