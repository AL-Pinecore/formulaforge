<div align="center">

# FormulaForge

[English](./README.en.md) | **中文**

[![CI](https://img.shields.io/github/actions/workflow/status/AL-Pinecore/formulaforge/build.yml?label=CI&style=flat-square)](https://github.com/AL-Pinecore/formulaforge/actions/workflows/build.yml)
[![Version](https://img.shields.io/github/v/release/AL-Pinecore/formulaforge?style=flat-square)](https://github.com/AL-Pinecore/formulaforge/releases)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-67C8A2?style=flat-square)](https://tauri.app/)
[![Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82?style=flat-square)](https://nuxt.com/)

一个拖拽式的 LaTeX 公式编辑器桌面应用。从左侧面板把公式元素拖进输入框，即可实时拼装公式，并导出为 SVG / PNG / JPEG / WebP / PDF。

</div>

## 声明
本项目完全由AI完成开发，旨在测试AI项目能力。

主模型：DeepSeek V4 Pro  
总消耗Token: 925,651,744  
缓存命中: 903,746,304  
缓存未命中: 18,103,078  
输出: 3,802,362

辅助模型：ChatGPT 5.6 Sol

## 功能

- **拖拽式编辑**：200+ 个公式元素（运算符、函数、分式、根号、求和/积分、希腊字母、逻辑/集合符号、箭头、上下标、矩阵等），可点击或拖拽插入。
- **实时预览**：基于 MathJax 的所见即所得渲染，导出效果与预览一致。
- **LaTeX 源码**：随时查看/编辑源码，支持复制（原始 / 行内 / 块级）、导入与导出 `.tex` 文件。
- **导出**：SVG、PNG、JPEG、WebP、PDF（可选背景色、内边距、分辨率、JPEG 质量、行间显示样式）。
- **桌面端**：基于 Tauri，文件对话框与图像/PDF 渲染在 Rust 侧完成，无浏览器沙箱限制。

## 技术栈

- **前端**：Nuxt 4 + Vue 3，[MathLive](https://cortexjs.io/mathlive/)（数学输入）、[MathJax](https://www.mathjax.org/)（SVG 渲染）
- **桌面壳**：Tauri 2 + Rust（`resvg` 渲染图片、`svg2pdf` 生成 PDF）
- **测试**：Vitest（单元 + Nuxt 组件）、Playwright（E2E）、Rust 单元测试

## 环境要求

- Node.js ≥ 22
- Rust stable（含 `rustfmt`、`clippy`，见 `src-tauri/rust-toolchain.toml`）
- 平台依赖：
  - **macOS**：Xcode Command Line Tools
  - **Linux**：`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`
  - **Windows**：WebView2 + MSVC

## 快速开始

```bash
# 安装依赖（postinstall 会自动拷贝 MathLive 字体 / MathJax 等 vendor 资源到 public/）
npm ci

# 浏览器开发（Nuxt dev server）
npm run dev

# 桌面应用开发（Tauri）
npm run tauri dev
```

## 打包桌面应用

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`（macOS 产出 `.app` / `.dmg`，Windows 产出 `.msi` / `.exe`，Linux 产出 `.deb` / `.rpm` / `AppImage`）。构建前会自动执行 `npm run generate`（`NUXT_SSR=false` 静态生成到 `dist/`）。

## 测试

```bash
npm run typecheck      # TypeScript 类型检查
npm test               # 运行全部前端测试（unit + nuxt）
npm run test:unit      # 单元测试
npm run test:nuxt      # Nuxt 组件测试
npm run test:rust      # Rust 单元测试
npm run test:e2e       # Playwright E2E 测试
npm run check:rust     # cargo fmt --check + clippy
```

## 项目结构

```
app/                    # Nuxt 前端
  components/           # 工作区、面板、工具栏、预览等组件
  composables/          # useEquation、useEquationExport
  data/                 # 公式元素定义
  plugins/              # mathlive 注册
  types/                # 类型定义
  utils/                # SVG 导出、剪贴板、空组恢复等工具
  app.vue               # 应用入口
src-tauri/              # Rust 桌面壳
  src/export.rs         # 导出命令（对话框 + resvg/svg2pdf 渲染）
  src/lib.rs            # Tauri 构建器与命令注册
  src/main.rs           # 入口
  tests/                # Rust 测试与 fixtures
scripts/                # copy-vendor-assets.mjs 等构建脚本
test/                   # 前端测试（unit / nuxt / e2e）
public/                 # 由脚本拷贝的 vendor 资源（MathLive 字体、MathJax）
```

## 脚本速查

| 命令                    | 说明                                  |
|-----------------------|-------------------------------------|
| `npm run dev`         | 启动 Nuxt 开发服务器                       |
| `npm run build`       | 构建 Nuxt 产物                          |
| `npm run generate`    | 静态生成（`NUXT_SSR=false`，供 Tauri 打包使用） |
| `npm run preview`     | 预览构建产物                              |
| `npm run tauri dev`   | 桌面应用开发模式                            |
| `npm run tauri build` | 打包桌面应用                              |
| `npm run typecheck`   | TypeScript 类型检查                     |
| `npm test`            | 运行前端测试                              |
| `npm run test:e2e`    | Playwright E2E 测试                   |
| `npm run test:rust`   | Rust 单元测试                           |
| `npm run check:rust`  | Rust 格式检查 + clippy                  |
