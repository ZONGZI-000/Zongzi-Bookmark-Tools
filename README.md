# 🎋 粽子书签工具

> Chrome / Chromium 书签管理扩展：检索、摘要、同步、备份、清理，一站式搞定。

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](#)
[![Manifest](https://img.shields.io/badge/manifest-v3-green)](#)
[![License](https://img.shields.io/badge/license-MIT-orange)](#)
[![Beta](https://img.shields.io/badge/release-v0.1.0--beta-yellow)](https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools/releases/tag/v0.1.0-beta)

[English](README_EN.md) | [GitHub](https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools)

---

## 📖 目录

- [功能概览](#-功能概览)
- [安装](#-安装)
- [使用指南](#-使用指南)
  - [书签检索](#1-书签检索)
  - [书签摘要](#2-书签摘要)
  - [书签同步](#3-书签同步)
  - [书签清理](#4-书签清理)
- [同步后端](#-同步后端)
- [权限说明](#-权限说明)
- [常见问题](#-常见问题)
- [开发与贡献](#-开发与贡献)

---

## ✨ 功能概览

### 🔍 书签检索
- 打开 popup 即展示本地书签，支持按标题、URL、文件夹路径快速检索

### 🤖 书签摘要
- 自动为书签生成摘要和关键词，支持多种 AI 引擎
- 引擎选择：TextRank 离线引擎 / 本地小模型 (ONNX) / Chrome Gemini Nano / 自定义 OpenAI / 自定义 Anthropic
- 本地模型支持一键文件夹导入，无需网络下载

### 🔄 书签同步
- 4 种同步后端任选，保留完整文件夹结构
- 智能同步：自动判断本地/远端变更方向，避免冲突
- 安全模式（默认）：下载不覆盖本地书签
- 完全镜像模式：远端书签结构完整覆盖本地
- 自动同步：支持定时自动备份

### 🧹 书签清理
- 重复书签清理：按 URL 去重，优先保留书签栏版本
- 空文件夹清理：递归清理无内容文件夹
- 失效书签扫描：检测 404、403、5xx、超时等失效链接
- 置信度分档：高（红色）/ 中（橙色）/ 低（灰色），一目了然
- 支持暂停/继续、多选、按类型筛选、选择性删除

### 🌐 其他亮点
- 中英文界面，popup 面板一键切换
- 敏感信息（密码、Token、API Key）本地加密存储
- 错误消息自动脱敏，不泄露密钥

---

## 📥 安装

### Chrome / Edge / Brave / 豆包 等 Chromium 浏览器

1. 打开浏览器，访问 `chrome://extensions/`
2. 打开右上角 **开发者模式** 开关
3. 点击 **加载已解压的扩展程序**
4. 选择本扩展文件夹
5. 安装完成，工具栏出现扩展图标

### 从 GitHub 下载

```bash
git clone https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools.git
```

或访问 [Releases](https://github.com/ZONGZI-000/Zongzi-Bookmark-Tools/releases) 下载最新版本压缩包。

---

## 📘 使用指南

扩展安装后，点击工具栏图标打开 popup 面板。

### 1. 书签检索

| 操作 | 说明 |
|---|---|
| 输入关键词 | 按标题、URL、文件夹路径搜索本地书签 |
| 点击结果 | 在新标签页打开对应书签 |

### 2. 书签摘要

| 操作 | 说明 |
|---|---|
| 选择引擎 | 在设置页「摘要引擎」tab 中选择 AI 引擎 |
| 导入本地模型 | 先从镜像站下载 ONNX 文件夹到本机 → 点击"选择模型文件夹导入" |
| 自动索引 | 开启后，新增书签自动生成摘要 |

**本地模型导入步骤：**

> 1. 打开 [HuggingFace](https://huggingface.co/Xenova/LaMini-Flan-T5-783M) / [hf-mirror](https://hf-mirror.com/Xenova/LaMini-Flan-T5-783M) / [ModelScope](https://modelscope.cn/models/Xenova/LaMini-Flan-T5-783M/files)
> 2. 下载完整的模型文件夹（包含 `onnx/` 子目录和 `tokenizer.json` 等 5 个文件）
> 3. 在设置页中点击 **选择模型文件夹导入**
> 4. 选中下载好的文件夹，一键导入完成

### 3. 书签同步

| 同步方式 | 按钮 | 说明 |
|---|---|---|
| 本地文件 | 导出文件 / 导入文件 | 手动 JSON 备份与恢复，无需网络 |
| WebDAV | 智能同步 / 上传 / 下载 | 通过 WebDAV 服务器同步 |
| GitHub | 智能同步 / 上传 / 下载 | 通过 GitHub 仓库同步 |
| Gitee | 智能同步 / 上传 / 下载 | 通过 Gitee 仓库同步 |

**下载模式：**

| 模式 | 行为 |
|---|---|
| 🔒 安全模式（默认） | 远端内容导入到独立文件夹，不覆盖本地书签 |
| 🪞 完全镜像模式 | 远端结构直接替代本地书签根目录 |

### 4. 书签清理

| 按钮 | 说明 |
|---|---|
| 一键清理 | 同时清理重复书签 + 空文件夹 |
| 清理重复 | 删除重复 URL 的书签，保留书签栏版本 |
| 清理空文件夹 | 递归删除无内容的空文件夹 |
| 清理失效书签 | 打开独立页面，扫描并选择性删除失效链接 |

**失效书签扫描：**

| 功能 | 说明 |
|---|---|
| 超时设置 | 可自定义请求超时秒数（默认 15s） |
| 暂停/继续 | 扫描过程中可随时暂停和继续 |
| 置信度分级 | 🔴 高：页面不存在（404）/ 🟠 中：超时、网络失败、服务器异常 / ⚪ 低：拒绝访问、证书风险 |
| 类型筛选 | 按问题类型实时筛选和选择 |
| 全选/多选 | 支持全选、按类型选择、手动勾选 |
| 删除确认 | 选中后统一删除，暂停时也可操作 |

---

## 🔌 同步后端

### 本地文件（默认）
- 无需任何网络配置，开箱即用
- 导出：将当前书签保存为 JSON 文件
- 导入：从 JSON 文件恢复书签

### WebDAV

| 配置项 | 说明 |
|---|---|
| 文件夹地址 | WebDAV 目录 URL，如 `https://example.com/remote.php/dav/files/USER/bookmarks/` |
| 用户名 | WebDAV 账号 |
| 密码/令牌 | 建议使用应用专用密码而非账号密码 |
| 远端文件名 | 同步的 JSON 文件名，默认 `chrome-bookmarks.json` |
| 请求超时 | 网络请求超时秒数（默认 30s） |

示例：
- Nextcloud: `https://example.com/remote.php/dav/files/YOUR_USER/bookmarks/`
- Synology NAS: `https://example.com:5006/bookmarks/`

### GitHub / Gitee

| 配置项 | 说明 |
|---|---|
| Token | Personal Access Token（需要 repo 权限） |
| 用户名/组织 | 仓库所属的账号或组织名 |
| 仓库名 | 目标仓库名称 |
| 分支 | 目标分支（默认 main） |
| 文件路径 | JSON 同步文件在仓库中的路径 |

---

## 🔐 权限说明

| 权限 | 用途 |
|---|---|
| `bookmarks` | 读写浏览器书签 |
| `storage` | 保存配置、加密凭据、同步状态 |
| `unlimitedStorage` | 存储本地 AI 模型文件（~370 MB） |
| `alarms` | 定时自动同步和清理 |
| `notifications` | 同步失败提醒 |
| `downloads` | 导出本地 JSON 备份文件 |
| `tabs` / `scripting` | 失效书签扫描的错误页诊断 |
| `offscreen` | 本地 AI 模型推理 |
| `host_permissions` | 访问 WebDAV / GitHub / Gitee API / 扫描书签链接 |

---

## ❓ 常见问题

<details>
<summary><b>安全模式和镜像模式有什么区别？</b></summary>

- **安全模式**：下载时把远端书签放入一个独立的文件夹（如 `其他书签/WebDAV Synced Bookmarks`），不会删除或覆盖你现有的本地书签。
- **镜像模式**：下载时用远端结构**完全替代**本地书签根目录（书签栏、其他书签等），本地原有书签会被删除。
</details>

<details>
<summary><b>智能同步和上传/下载有什么区别？</b></summary>

- **智能同步**：自动判断本地和远端谁更新，避免手动选择方向。如果两边都改了（冲突），会停下来让你手动决定。
- **上传**：强制用本地覆盖远端。
- **下载**：强制用远端覆盖本地。
</details>

<details>
<summary><b>失效书签扫描的置信度颜色是什么意思？</b></summary>

| 颜色 | 置信度 | 含义 |
|---|---|---|
| 🔴 红色 | 高 | 明确失效，如 404 页面不存在，建议删除 |
| 🟠 橙色 | 中 | 可能失效，如超时、网络错误、服务器异常，建议复查 |
| ⚪ 灰色 | 低 | 不一定失效，如 403 拒绝访问、证书风险、限流，人工判断 |
</details>

<details>
<summary><b>我的书签突然不见了怎么办？</b></summary>

1. 检查是否误选了**镜像模式**下载 —— 镜像模式会替换本地书签
2. 检查是否用 WebDAV / GitHub / Gitee 上传了空快照
3. 如果有本地 JSON 备份，用「导入文件」恢复
4. 如果远端有历史版本，用「下载」恢复
</details>

<details>
<summary><b>豆包浏览器能用吗？</b></summary>

可以。豆包浏览器基于 Chromium，支持 Chrome MV3 扩展。
已将重复函数声明、Service Worker 加载失败等问题做了兼容处理。
</details>

<details>
<summary><b>WebDAV 连接不通怎么办？</b></summary>

1. 确认浏览器能直接访问 WebDAV 地址
2. 检查用户名密码是否正确
3. 使用应用专用密码而非账号密码（如 Nextcloud 需在设置中生成）
4. 调大请求超时（如 60 秒），特别是代理网络环境
5. 点击「测试 WebDAV」看具体错误信息
</details>

---

## 🛠 开发与贡献

### 技术栈

| 层 | 技术 |
|---|---|
| 扩展框架 | Chrome Manifest V3 |
| 存储 | IndexedDB + chrome.storage |
| AI 推理 | Transformers.js + ONNX Runtime Web |
| 加密 | Web Crypto API (AES-GCM) |
| 同步 | WebDAV / GitHub API / Gitee API |

### 项目结构

```
chrome-webdav-bookmark-sync/
├── manifest.json              # 扩展声明
├── background.js              # Service Worker 后台逻辑
├── popup.html / popup.js      # Popup 弹窗面板
├── options.html / options.js  # 设置页
├── invalid.html / invalid.js  # 失效书签扫描页
├── i18n.js                    # 中英文文案资源
├── app-config.js              # 全局配置与工具函数
├── offscreen-inference.js     # 本地 AI 模型推理
├── styles.css                 # popup / 设置页样式
├── import-model.css           # 模型导入区样式
├── icons/                     # 扩展图标
├── lib/                       # 第三方库 (Transformers.js)
└── models/                    # 内置轻量模型文件
```

### 构建与发布

本扩展为纯静态文件，无需构建步骤。修改代码后直接重新加载扩展即可生效。

发布新版本：

```bash
# 更新 manifest.json 中的 version
git add -A
git commit -m "vX.Y.Z: release notes"
git tag vX.Y.Z
git push origin main --tags
```

---

## 📄 License

MIT © ZONGZI-000

---

<p align="center">
  <sub>Made with ❤️ for bookmark lovers | 为书签爱好者而生</sub>
</p>
