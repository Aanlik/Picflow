# 发布流程

1. 在 `dev` 完成改动、代码审查和回归测试，再将通过验证的版本合并到 `main`。
2. 确认中文资源、前后端、Bridge、统一镜像启动和集成测试均通过。
3. 更新 Compose 固定版本、README、CHANGELOG 和部署配置。
4. 在 `main` 手动运行 Picflow 工作流，并勾选发布；只有完整验证通过后才会推送固定版本镜像。
5. 镜像推送成功后，在 GitHub Releases 创建对应版本的正式 Release。更新检查只读取 Release，不会自动下载或安装。
6. 升级前备份 Picflow 数据卷、Bridge 状态卷及项目交付目录。Camera 原片保持只读挂载。

`main` 是主线和正式发布分支，`dev` 用于日常开发。不发布可变的 `latest`、`stable` 或 `main` 镜像标签，也不自动同步上游代码。
