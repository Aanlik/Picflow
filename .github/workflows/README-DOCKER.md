# 统一镜像 CI

`unified.yml` 是当前发布入口。`main` 和 `dev` 的推送以及 PR 都会自动检查前端、后台、中文翻译和 Bridge，通过后构建根目录 Dockerfile，并执行容器启动/重启测试与 100 张照片真实 E2E。`main` 是默认主线和正式发布分支，`dev` 用于日常开发。

仅 main 上的手动 workflow_dispatch，且 publish 勾选为 true 时，才在验证完成后推送 `ghcr.io/<仓库所有者>/picflow:<固定版本>`。工作流不会创建 GitHub Release；发布者需在镜像推送成功后创建同版本 Release，设置页的更新检查才会发现它。不推送 latest，不自动合并上游，也不分别发布前后端和 Bridge。

发布前同步更新 Dockerfile、构建脚本、Compose、.env.example、README 和 workflow 中的版本。保留测试数据库隔离：E2E 只操作 picflow- 开头的临时容器，不复用生产卷。
