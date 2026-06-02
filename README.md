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

## 🤖 AI 制作

本项目由以下 AI 技术辅助开发与设计：

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
