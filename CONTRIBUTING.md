# 开发规范

本仓库已合并客户选片前后端与独立 Bridge 服务。开发使用 `dev`，经代码审查和构建检查后合并 `main`。RAW 原目录始终只读。

提交前运行中文资源检查、前端构建与 lint、后端 lint、依赖安全检查及统一镜像构建。涉及交付、撤回、归档、备份时，应在部署环境核对升级和恢复行为。

发布操作见 [RELEASING.md](RELEASING.md)。反馈使用 [本项目 Issues](https://github.com/Aanlik/Picflow/issues)，安全问题使用 [SECURITY.md](SECURITY.md)。
