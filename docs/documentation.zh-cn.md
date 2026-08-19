# FormulaForge 实现文档

每篇文档聚焦一个功能的实现机制（涉及文件、数据流、设计取舍、已知边界）。功能概览、环境搭建、打包与测试见 [README](../README.md)。

## 目录

| 文档 | 内容 |
|------|------|
| [编辑器与拖拽插入](editor.zh-cn.md) | `<math-field>` 初始化、状态单例、拖拽插入、mirror 预览、偏移计算 |
| [Text 文本框编辑](text-box.zh-cn.md) | 零宽边界 marker、空盒哨兵、删除/输入整组重建、字体样式拖放 |
| [编辑语义](edit-semantics.zh-cn.md) | 空组恢复 placeholder、accent 居中/宽帽修正、Backspace 结构解包 |
| [矩阵编辑](matrix.zh-cn.md) | 内部模型读取、右键菜单、Enter/Delete 增删行列 |
| [LaTeX 渲染与实时预览](rendering.zh-cn.md) | MathJax 加载、SVG 渲染管线、MathPreview 防抖、MathChip 缩放 |
| [多格式导出](export.zh-cn.md) | 浏览器与 Rust 两条导出路径、SVG 校验、原子写、并发守卫 |
| [LaTeX 源码面板与剪贴板](latex-source.zh-cn.md) | 源码双缓冲、三种复制格式、`.tex` 导入导出 |
| [国际化（i18n）](i18n.zh-cn.md) | locale 自动发现、`t()` 回退链、MathLive 词条覆盖、添加语言 |
| [主题系统](theme.zh-cn.md) | `data-theme` + CSS 变量、localStorage 持久化、早应用防闪屏 |
| [桌面集成与输入法](desktop-ime.zh-cn.md) | Tauri 命令注册、macOS 输入源切换、JS 层 IME 阻断 |
