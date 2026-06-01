# Zongzi Bookmark Tools

Chrome Manifest V3 extension for searching, summarizing, syncing, backing up, and cleaning browser bookmarks while preserving folder structure.

## Features

- Multiple sync backends: WebDAV, local JSON file import/export, GitHub, and Gitee.
- Default sync method is local file import/export for quick backup and restore without network setup.
- Supports English and Chinese UI text, switched directly from the popup panel.
- Upload the full Chrome bookmark tree to one JSON snapshot while preserving folder structure.
- Download remote bookmarks in safe mode by appending remote root contents into matching local roots, or in full mirror mode by replacing local bookmark roots.
- Smart sync detects whether local or remote data changed after the last successful sync.
- Local file backup works without network access through Export File and Import File.
- GitHub/Gitee sync uses the Contents API; repository commits become version history.
- Manual actions: Smart Sync, Upload, Download, duplicate cleanup, empty folder cleanup, and invalid bookmark review.
- Automatic sync through Chrome alarms for WebDAV/GitHub/Gitee.
- Local model downloads support official HuggingFace, China mirrors, custom mirror URLs, auto fastest selection, fallback retry, and file-level resume.

## Install locally

1. Open Chrome and go to `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `D:\workspace\chrome-webdav-bookmark-sync`.
5. Open the extension settings, choose a sync backend, then use the popup to switch English/Chinese or choose the download mode.

## Sync backend options

- Local file: export a JSON backup or import a JSON backup manually. This is the default sync method, and auto sync is not available for local files.
- WebDAV: configure a WebDAV folder URL, username, password/app token, remote file name, and request timeout.
- GitHub: configure token, owner/organization, repository, branch, and file path. The extension reads/writes one JSON file through GitHub Contents API.
- Gitee: configure token, owner/organization, repository, branch, and file path. The extension reads/writes one JSON file through Gitee Contents API.

The popup only shows actions that match the selected backend: WebDAV/GitHub/Gitee show Smart Sync, Upload, and Download; Local file mode shows Export File and Import File only.

## WebDAV configuration examples

- Nextcloud: `https://example.com/remote.php/dav/files/YOUR_USER/bookmarks/`
- Synology: `https://example.com:5006/bookmarks/`
- Generic WebDAV: use the directory URL where the JSON sync file should be stored.

The extension writes one file by default: `chrome-bookmarks.json`.

## Important behavior

Downloads use Safe mode by default. Safe mode does not overwrite Chrome's native bookmark roots directly. Instead, it rebuilds folders for remote roots that actually exist, such as Bookmarks Bar and Other Bookmarks, under the matching local roots. Empty or missing remote roots are not created, and unrelated local bookmarks are kept.

Full mirror mode can be selected in the popup panel. In this mode, a download deletes and rebuilds the writable local bookmark roots so they match the remote snapshot. Local file import uses the same safe/mirror mode behavior. Use mirror mode only when the imported or remote file is the source of truth.

If both local and remote bookmarks changed after the last sync, Smart Sync stops and asks you to resolve the conflict manually by choosing Upload or Download.

## Permissions

- `bookmarks`: read and create bookmark folders/items.
- `storage`: save sync settings, encrypted credentials/tokens, sync state, and local history.
- `alarms`: run automatic sync on an interval.
- `notifications`: show sync failures.
- `downloads`: export local JSON bookmark backups.
- `host_permissions`: allow direct requests to HTTP/HTTPS WebDAV, GitHub, Gitee, and scanned bookmark endpoints without extra per-site permission prompts.

## Notes

- Prefer a WebDAV app password/token or a scoped Git token instead of your account password.
- WebDAV must support `GET` and `PUT` for the target JSON file.
- GitHub/Gitee tokens need repository content read/write permission for the configured repository.
- Browser native cloud bookmark sync cannot be driven by this extension; keep it as an external browser feature rather than an in-extension sync backend.
- If the server has strict CORS rules, Chrome extensions usually bypass normal page CORS, but server authentication and TLS configuration must still be valid.
