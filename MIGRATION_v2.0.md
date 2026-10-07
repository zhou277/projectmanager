# v1.x → v2.0 迁移

1. 先备份旧数据库：

```text
robot_project_manager.db
```

2. 构建 v2.0：

```bat
build.bat
```

3. 将旧数据库复制到：

```text
dist\
```

最终：

```text
dist\
├── RobotProjectManager.exe
└── robot_project_manager.db
```

4. 双击 `RobotProjectManager.exe`。

不需要导出或重新导入项目。

## 保留的旧结构

为了兼容 v1.x：

- `milestones` 表保留，但 Web UI 不展示里程碑。
- `tasks.owner` 保留，但新任务 UI 不使用任务负责人。
- `estimate_hours / actual_hours` 保留，但新 UI 不展示工时。
- `tests.software_version` / `issues.software_version` 保留，但新 UI 使用版本关系表。
