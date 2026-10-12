# Bridge 内部服务

本目录是 Picflow 统一镜像中的精修同步服务。部署、构建、版本升级和目录挂载以根目录 [README](../README.md)、[Dockerfile](../Dockerfile) 和 [compose.yaml](../compose.yaml) 为准。

Bridge 保留独立 Python 模块、SQLite 状态和测试，不单独对外开放端口。开发测试：

```sh
uv sync --directory bridge --extra test
uv run --directory bridge pytest -q
```

Bridge 只作为统一镜像的内部进程运行。代码来源和许可见[代码来源记录](../docs/source-provenance.md)，数据卷和升级边界见[运行架构说明](../docs/upgrade-and-data.md)。
