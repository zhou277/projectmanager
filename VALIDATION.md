# projectmanager v3.21.0 验证记录

验证日期：2026-10-07（Asia/Shanghai）。
基线：用户提供的 D:\Codex_workspace\projectmanager\projectmanager_v3.20.0。

## 运行环境

Windows、Python 3.14、Node.js 24.19.0、FastAPI 0.142.2、Starlette 1.7.0、
pytest 9.1.1、httpx 0.28.1。真实浏览器检查使用本机 Chrome 和 Playwright 1.63.0。
所有验证使用临时数据库，不访问用户项目数据库。

## 最终检查

运行 python tools/check.py：

```text
Python syntax: 10 files passed
JavaScript syntax: 19 files passed
48 passed, 1 warning in 5.83s
```

48 项 pytest 包含 46 个 API/数据库用例、全部前端 JS 语法检查和 Node 运行回归。
Node 前端共有 25 个用例，全部通过，无跳过。

新增用例覆盖多前置创建/修改/清空，自己/跨项目/缺失/无效 ID 拒绝，直接和间接循环拒绝，
并发互相依赖不能形成循环，部分更新和状态/优先级更新保留依赖及版本关联，
依赖延期传递、日期冲突、完成后的风险解除，删除任务/项目清理关系，备份包含新字段与关系，
旧数据库迁移及重复迁移，Dashboard 加权汇总、项目隔离、测试通过率、空状态、
日期边界、完成时间/重新打开/周一边界、未知完成日期不误计入本周完成。
原有任务/子任务、Issue、版本、测试记录、设置和备份回归用例继续通过。

唯一 warning 为当前 Starlette 对 httpx TestClient 的弃用提示，未导致失败。

## 实际浏览器检查

已运行随工程提供的 python tools/browser_smoke.py，退出码 0：

- 默认进入个人 Dashboard，显示全部项目和整体指标。
- 个人 Dashboard 跳转项目 Dashboard、任务明细跳转编辑窗口。
- 新增第二个前置任务，保存后真实 HTTP 数据持久化。
- 循环依赖保存被拒绝，编辑弹窗保留并提示原因，原依赖不被修改。
- 甘特图显示两条 SVG 依赖箭头，实际尺寸与坐标有效，原悬停浮动提示可用。
- 内联优先级/完成状态修改正常，本周完成指标随之更新。
- 深浅主题、1440px 和 900px 布局、页面重新加载验证通过。
- 没有 JavaScript 运行错误。

检查生成并查看了个人 Dashboard 深色/浅色、项目 Dashboard、甘特图和窄屏截图。
这些截图使用演示数据；截图和临时服务日志不放入发布包。

## 发布完整性

- v3.20.0 的 91 个全局函数均保留且各定义一次，包括全部公共弹窗辅助函数。
- 前端共 106 个函数，新增模块仍由静态 HTML 顺序加载，无 Node 构建。
- 原运行依赖、图标、启动和 EXE 打包入口保持原样。
- 数据库迁移只新增依赖表/索引和可空 completed_at 字段，不推测旧任务完成时间。
- 工程包排除虚拟环境、build/dist、生成的 spec、缓存、截图、日志和用户数据库。
- 本次验证源码/HTTP/浏览器流程，未构建新的 Windows EXE。
