<div align="center">
  <img src="docs/picflow-icon.png" alt="Picflow" width="220" />
</div>

# Picflow 中文选片与精修交付

Picflow 是基于 [PicPeak/picpeak](https://github.com/PicPeak/picpeak) 定制并独立维护的中文照片选片与精修交付平台。客户在网页相册中选片、评论和提出返修需求，摄影师在 NAS 上完成精修，成片自动回传到原分享页面。

本项目沿用 PicPeak 的相册与分享能力，围绕中文摄影工作流集成 PixCake Bridge、NAS 原片匹配和版本交付。感谢 PicPeak 原作者及贡献者；上游代码来源与版权记录见下方[项目来源与维护](#项目来源与维护)。

Picflow 与内置的精修同步服务运行在同一个 Docker 镜像中。Photoshop、Lightroom、像素蛋糕等后期软件通过 NAS 文件夹参与工作流，无需软件 API 或插件；摄影师需自行导入待精修文件，并将成片导出到指定目录。

[部署到 NAS](#部署到-nas) · [选片与交付](#选片与交付) · [目录约定](#目录约定) · [常见问题](#常见问题) · [项目来源](#项目来源与维护) · [开发与检查](#开发与检查)

## 当前功能

| 使用者 | 主要功能 |
| --- | --- |
| 客户 | 手机或电脑浏览相册、标记精修、批量选片与评论、评分、点赞、下载，以及提交或撤回后续需求 |
| 摄影师 | 在项目详情查看选片进度、RAW 匹配、照片版本、客户说明和同步异常，管理阶段与需求状态 |
| Bridge | 匹配 NAS RAW、接入客户上传源图、生成待精修文件、监控成片目录、去重并回传版本 |

- **分享链接持续有效**：成片替换同一照片记录的预览，保留照片编号、客户反馈和原分享链接。
- **返修按版本交付**：首次使用 `V1`，后续使用 `V2`、`V3` 等目录，工作台显示每张照片的下一次导出路径。
- **原片只读挂载**：Camera 对应用保持只读，精修工作区单独可写。Bridge 不修改、重命名或删除 Camera 中的 RAW。
- **中文界面**：提供简体中文和英文，默认使用简体中文；精修选择与普通颜色标签分别管理。
- **人工管理需求**：在项目内处理追加选片、返修、撤回和同步异常，保留客户说明与处理历史。

当前版本已移除“相册里的人”人物识别模块，包括相关界面、接口、后台扫描和独立 ML 服务，不提供开启入口。升级会清理派生人物索引、识别设置及自动分类标记，保留项目、照片、评论、评分和手动分类。其他裁剪与版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 部署到 NAS

适用于能够运行 Docker Compose 的 Linux NAS，包括飞牛 fnOS、群晖、威联通等。具体宿主机路径和 UID/GID 应以你的 NAS 为准。

### 1. 准备目录与配置

将仓库放到 NAS 或构建用的 Docker 主机上，在仓库根目录执行：

```sh
cp .env.example .env
```

先在 NAS 上创建 `PixCakeDelivery` 文件夹，再编辑 `.env` 中的以下配置：

| 变量 | 填写内容 |
| --- | --- |
| `LAN_BIND_IP` | NAS 的局域网 IPv4；默认 `127.0.0.1` 仅允许本机访问 |
| `PICFLOW_PORT` | 网页访问端口，默认 `3000` |
| `NAS_CAMERA_ROOT` | 已存在的 Camera 文件夹的 NAS 绝对路径 |
| `NAS_RAW_ROOT` | 通常与 `NAS_CAMERA_ROOT` 相同，用于解析 Camera 相对项目路径 |
| `NAS_DELIVERY_ROOT` | 已创建的交付文件夹绝对路径，例如 Camera 下的 `PixCakeDelivery` |
| `NAS_CAMERA_UID` / `NAS_CAMERA_GID` | 能读取 Camera 的用户与组 ID |
| `BRIDGE_UID` / `BRIDGE_GID` | 能写入交付文件夹的用户与组 ID |

[`.env.example`](.env.example) 中的 `/vol1/1000/Home/Camera` 是飞牛路径示例，请替换成真实路径。Compose 使用 `create_host_path: false`，不会自动创建这些宿主机目录。

### 2. 检查、构建并启动

```sh
# 检查环境变量与挂载配置
docker compose -f compose.yaml -f compose.nas-camera.yaml config

# 构建当前固定版本镜像
./scripts/build-picflow.sh

# 启动服务
docker compose -f compose.yaml -f compose.nas-camera.yaml up -d
```

默认构建平台为 `linux/amd64`。ARM64 NAS 使用以下命令替换构建步骤：

```sh
PLATFORM=linux/arm64 ./scripts/build-picflow.sh
```

如果在其他 Docker 主机上构建，需要将构建出的同版本镜像转移并加载到 NAS，再在 NAS 上启动 Compose。

当前 [Compose](compose.yaml) 固定使用本地镜像 `picflow:1.0.3`；上面的构建脚本从 Compose 读取镜像版本，不要求自行拼接版本号。正式发布流程见 [RELEASING.md](RELEASING.md)。

### 3. 初始化并关联照片

1. 打开 `http://NAS局域网IP:3000/setup`，创建管理员账号；修改端口后使用对应端口。
2. 新建项目，将媒体来源关联到 Camera 下的样片文件夹，例如 `26-10-04/02_PROOF`。
3. 在项目详情的“选片与精修进度”中点击“自动关联项目文件夹”。系统通过挂载与权限检查后，会在统一交付根目录下创建该项目的工作区；无需为每个项目修改 Compose 挂载。随后检查 RAW 匹配结果。
4. 获取项目分享链接，交给客户选片。

健康检查地址为 `http://NAS局域网IP:3000/health`。新项目在统一交付根目录中创建工作区，无需逐项目新增 Docker 挂载。

> [!IMPORTANT]
> 首次初始化请在局域网完成。客户从外网访问时，为 Picflow 网页配置能够匿名打开分享页的 HTTPS 地址。

## 选片与交付

| 步骤 | 操作与结果 |
| --- | --- |
| 1. 客户选片 | 客户通过分享页标记需要精修的照片，并填写评论或需求 |
| 2. 检查待精修文件 | 摄影师在项目工作台查看匹配与异常；Bridge 将对应源文件放入 `03_SELECTED_RAW` |
| 3. 开始后期 | 摄影师切换项目阶段，通过 SMB 等方式在后期软件中导入待精修目录 |
| 4. 导出成片 | 首次导出到 `04_FINAL/V1`，后续按工作台提示导出到该照片的下一版本目录 |
| 5. 自动交付 | Bridge 等待文件稳定，检查内容哈希，随后替换 Picflow 中同一照片的预览 |
| 6. 处理返修 | 在需求卡片中查看客户说明、历史状态和导出路径，更新处理状态并交付新版本 |

成片支持 JPG、JPEG、PNG。**保留源文件名主干**：`DSC00125.ARW` 对应 `DSC00125.JPG`。客户上传文件可能获得不同的工作文件名，应以工作台显示的名称和导出目录为准，不依赖 NAS 自动添加的重名序号。

客户可以按待选、已选、精修中、已交付和待处理需求等状态筛选照片。返修回传后，预览 URL 会随版本更新以刷新缓存；相册照片和精修流程状态约每 15 秒刷新一次。

撤回精修选择的处理取决于项目进度。项目从未进入精修阶段时，Bridge 会清理自己创建且校验未变的 `03_SELECTED_RAW` 副本，Camera 原片不受影响；项目进入过精修后，撤回未交付照片不会自动删除可能正在处理的工作副本，即使项目阶段后来退回也一样。对已交付照片，客户可以选择删除或保留成片：选择删除会把 Picflow 预览恢复为样片（用户上传的照片则恢复为上传原图），并删除该照片对应的 `04_FINAL` 成片和 Bridge 交付快照；选择保留会保留成片与预览，同时撤销精修选择并移除工作区中的 RAW 关联。详细规则见[中文摄影工作流与状态说明](docs/zh-CN-photography-ui.md)。

## 目录约定

建议将 JPG 样片与 RAW 放在同一拍摄项目下，使用相同文件名主干。关联 `02_PROOF` 后，系统自动关联相邻的 `01_RAW`。

```text
Camera/
├── 26-10-04/
│   ├── 01_RAW/                    # RAW 原片，只读
│   │   └── DSC00125.ARW
│   └── 02_PROOF/                  # 客户浏览的样片，只读
│       └── DSC00125.JPG
└── PixCakeDelivery/               # 单独可写挂载
    └── 26-10-04/                  # 项目工作区
        ├── 03_SELECTED_RAW/       # 已选 RAW 或客户上传源图
        ├── 04_FINAL/
        │   ├── V1/                # 首次成片
        │   └── V2/                # 返修成片
        └── 05_HISTORY/            # 历史快照
```

RAW 支持 `.ARW`、`.CR3`、`.CR2`、`.NEF`、`.RAF`、`.DNG`、`.ORF`、`.RW2`。同一匹配范围内出现多个同主干 RAW 时，Bridge 会报告文件名冲突，需要人工处理。

客户上传的非 RAW 图片无需对应 RAW，Bridge 从 Picflow 本地上传存储读取源图并加入待精修目录。NAS 引用样片则依赖原文件路径，关联后不要移动、重命名或删除样片。

默认 `RAW_MATERIALIZE_MODE=auto`：仅对只读原始 inode 尝试 hardlink，再尝试 reflink，最后复制，不使用符号链接。若后期软件会改写导入文件，设为 `copy` 使用隔离副本。

<details>
<summary>同步参数与运行结构</summary>

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `POLL_SECONDS` | `30` | Bridge 周期轮询间隔，秒 |
| `STABLE_SECONDS` | `10` | 成片文件稳定等待时间，秒 |
| `MAX_FINAL_BYTES` | `104857600` | 单个成片上限，100 MiB |
| `HISTORY_KEEP` | `3` | 每张照片在 `05_HISTORY` 中保留最近的 Bridge 交付快照数；不限制 `04_FINAL/Vn` 下的成片版本目录 |
| `RAW_MATERIALIZE_MODE` | `auto` | 源文件物化策略，可用 `copy` 强制复制 |

Bridge 结合文件事件与周期扫描检测成片，以 SHA-256 去重；相同内容不会重复上传。返修只扫描每张照片当前待交付的版本目录，失败或待上传任务不计入成功版本数。

单个 `picflow:1.0.3` 镜像运行 Picflow 与 Bridge，默认使用 SQLite，不需要 PostgreSQL、Redis 或单独的 Bridge 容器。Picflow 提供唯一网页入口；Bridge 监听容器回环地址 `127.0.0.1:8080`，通过 Picflow 后台代理调用，无需单独账号或 Public API Token。Compose 服务名为 `picflow`；逻辑数据卷为 `picflow-data` 与 `picflow-bridge-data`，物理卷名保留旧安装命名。

| 持久化位置 | 用途 |
| --- | --- |
| `/data`（`phoflow_data` 卷） | Picflow 数据；保留旧卷名以兼容现有安装 |
| `/bridge-data`（`phoflow_bridge_data` 卷） | Bridge 配置与状态；保留旧卷名以兼容现有安装 |
| `/external-media/Camera`（只读挂载） | NAS 样片与 RAW |
| `/delivery`（可写挂载） | 精修工作区与历史成片 |

已有独立项目挂载可通过 `PROJECT_DELIVERY_MOUNTS` 等兼容设置保留，详情见 `.env.example`；新项目使用统一交付根目录。

</details>

## 常见问题

**网页无法从局域网打开？**

检查 `LAN_BIND_IP` 是否仍为 `127.0.0.1`，确认它是 NAS 的真实局域网地址，再检查端口与 NAS 防火墙。可在仓库目录查看日志：

```sh
docker compose -f compose.yaml -f compose.nas-camera.yaml logs --tail=100 picflow
```

**找不到照片目录，或无法生成待精修文件？**

先核对宿主机路径是否存在、UID/GID 是否有读取 Camera 和写入交付目录的权限，再检查项目关联与 RAW 文件名。Camera 维持只读，调整交付目录的写入权限即可。

**导出的成片没有回传？**

检查文件名主干、格式、大小和工作台显示的 `Vn` 路径，等待文件稳定后查看同步异常。可在工作台立即同步、重扫或重试失败任务；后期软件未发现新增源文件时需刷新或重新导入目录。

**可以直接用 FN Connect 给客户分享吗？**

未登录飞牛账号的匿名客户访问尚未完成现场验证。外网入口应实际测试匿名分享页访问；可使用 DDNS、反向代理或临时穿透为 Picflow 提供 HTTPS，仅发布网页端口，Bridge 的 `8080` 不对外映射。

## 升级与备份

设置页提供手动更新检查，从 `PICFLOW_GITHUB_REPOSITORY` 指定仓库（默认 `Aanlik/Picflow`）读取正式 GitHub Releases，不会自动下载或安装。上游 PicPeak 的版本与 Picflow 的发布版本分别维护。

升级前备份 Picflow `/data`、Bridge `/bridge-data`、`.env`、Compose 文件及 NAS 的 `PixCakeDelivery`，Camera 原片由 NAS 常规备份方案保护。备份数据库时停机或使用一致性备份方式。

全新安装使用 `phoflow_data` 与 `phoflow_bridge_data` 作为物理数据卷名，这是为了兼容此前 Phoflow 安装。升级时先停止旧的 Phoflow 容器，再使用 Picflow Compose 启动；确认挂载仍指向这两个卷后再启动，避免新建空卷或发生端口冲突。不要手工改名，也不要执行 `docker compose down -v`。

> [!WARNING]
> `docker compose down -v` 会删除应用数据卷。升级时不要使用 `-v`。

数据库与工作流迁移按向前升级维护。若需回退，恢复升级前的一致性备份，不要仅换回旧镜像。详细说明见[运行架构与升级边界](docs/upgrade-and-data.md)。

## 项目来源与维护

| 来源 | 引用与说明 |
| --- | --- |
| PicPeak 上游代码 | [PicPeak/picpeak](https://github.com/PicPeak/picpeak)，本项目相册、照片分享与管理能力的代码来源 |
| 原始代码基线 | 按仓库来源记录，基线为 `v3.134.1`，原始 stable 提交为 [`5fc54d9a5e17a7f054c926922a6f820f3c98eda2`](https://github.com/PicPeak/picpeak/commit/5fc54d9a5e17a7f054c926922a6f820f3c98eda2)；这是来源追溯信息，不表示当前代码与该版本相同 |
| PixCake Bridge | 通过 Git subtree 导入 `bridge/`，导入基准 `0746de8`；保留独立模块、状态库和 [Bridge 许可文件](bridge/LICENSE) |
| 当前维护仓库 | [Aanlik/Picflow](https://github.com/Aanlik/Picflow)，使用 Picflow 产品名称与独立发布版本 |

感谢 PicPeak 原作者和社区贡献者。本仓库保留上游 MIT 许可与版权声明，见根目录 [LICENSE](LICENSE)；再分发时须保留适用声明，并分别核对依赖、字体及其他资源的许可。详细记录见[代码来源记录](docs/source-provenance.md)和[运行架构与升级边界](docs/upgrade-and-data.md)。

Picflow 不自动同步或合并官方 PicPeak 更新，也不承诺提供上游全部功能。部署与功能说明以当前仓库的代码、Compose 和发布记录为准。

## 开发与检查

| 目录 | 内容 |
| --- | --- |
| `frontend/` | React、TypeScript、Vite 客户与摄影师界面 |
| `backend/` | Node.js、Express Picflow 服务 |
| `bridge/` | Python、FastAPI 精修同步服务与测试 |
| `scripts/` | 构建、翻译检查等工具 |
| `.github/workflows/` | 自动检查与容器验证 |

本地检查需要 Node.js 22.12 或更新版本、Python 3.12 或更新版本及 uv；统一镜像构建需要 Docker。

<details>
<summary>安装依赖并运行主要检查</summary>

在仓库根目录执行：

```sh
# 中文翻译检查
node scripts/check-zh-cn.mjs
node scripts/check-locale-usage.mjs

# 前端
npm ci --prefix frontend --legacy-peer-deps
npm --prefix frontend test
npm --prefix frontend run build:check
npm --prefix frontend run lint

# 后端
npm ci --prefix backend
npm --prefix backend run lint
npm --prefix backend test -- --runInBand --silent

# Bridge
uv sync --directory bridge --frozen --python 3.12 --extra test
uv run --directory bridge pytest -q

# 统一镜像
./scripts/build-picflow.sh
```

[统一验证工作流](.github/workflows/unified.yml) 配置了前后端与 Bridge 检查、依赖审计、容器启动与重启、真实 Picflow + Bridge 的 100 张照片端到端流程，以及模拟手机浏览器的下载测试。这些自动检查不能替代具体 NAS 型号与实体手机的现场验收。

</details>

## 进一步阅读

- [中文摄影工作流与状态说明](docs/zh-CN-photography-ui.md)
- [中文界面维护与翻译检查](docs/zh-CN-maintenance.md)
- [Bridge 内部服务与测试](bridge/README.md)
- [代码来源与许可记录](docs/source-provenance.md) · [运行架构与升级边界](docs/upgrade-and-data.md)
- [版本记录](CHANGELOG.md) · [发布流程](RELEASING.md)
- [部署配置](compose.yaml) · [NAS 配置补充](compose.nas-camera.yaml) · [环境变量示例](.env.example)
