# OpenDot

自托管的个人 AI 助手和团队。界面是简体中文。

当前已实现小点的真实流式对话、SQLite 历史保存、失败重试、登录和模型设置。团队页可以新建自定义 Dot。工作页可以新建目标。设置页可以管理工作区记忆、渠道和设备节点。后续计划见 [docs/ROADMAP.md](docs/ROADMAP.md)。

未配置模型时明确显示演示模式。接入 OpenAI 兼容服务后支持多轮真实对话，界面展示实际模型与返回的 Token 用量。

## 自定义 Dot

团队页可以新建 Dot：形状、颜色、名字，以及可选的角色说明。主 Dot「小点」保持原样。自定义资料写在数据卷的 `dots.sqlite`，和聊天库分开，重新部署不会丢。自定义 Dot 还没有独立会话；「开始对话」会进入详情里的说明，并可以先去和小点对话。详情有「对话 / 当前工作 / 能力 / 记忆 / 设置」五个标签，后三个先是说明。

## 我的工作

「工作」页可以新建目标：目标、完成条件（每行一条）、工作区、下一步，以及最多执行次数（1–10000，默认 10，超出范围会拒绝）。列表按全部、进行中、需要你处理、已完成、计划与例行筛选。新建的目标记为计划，这一天不会真正执行。资料写在数据卷的 `work.sqlite`，和聊天库、`dots.sqlite` 分开，刷新和重新部署后还在。

## 工作区记忆

设置页可以记下四类记忆：事实、决策、经验和待跟进。可以搜索，编辑会生成新版本并保留历史版本，也可以忘记。忘记一条记忆不会删除聊天记录。

工作区记忆只在自己的工作区里使用。个人记忆默认不能跨工作区；每一条都有单独的授权开关，打开后其他工作区才能用到它。Mem0 只有一个开关，默认关闭，不会连接 Mem0 服务。

这些资料写在数据卷的 `memory.sqlite`，和聊天库、`dots.sqlite`、`work.sqlite`、`channels.sqlite` 分开，重新部署不会丢。

## 渠道与设备

设置页可以启用或停用飞书、Telegram、QQ、微信、钉钉、Discord 和 WhatsApp，并填写各自的凭据。凭据用与模型配置相同的 AES-256-GCM 方式加密，接口只说明是否已填写，不会把原文返回给浏览器。新群的默认响应可以设为仅在 @机器人 时回复，或全部回复。错误的 `/pair` 配对码会被拒绝。Telegram 可以调用 getMe 校验 Token，网络失败会提示中文错误，这一步不注册 webhook。

设备节点默认关闭。开启后可以生成配对码，再用「模拟本地节点提交」完成配对。列表会显示已配对设备是在线还是离线。设备离线时，任务会等待原来的那台设备，不会改派。

这些资料写在数据卷的 `channels.sqlite`，和聊天库、`dots.sqlite`、`work.sqlite` 分开。

## 技术栈

- Next.js 15、React 19、TypeScript
- Tailwind CSS 4
- Docker Compose，SQLite 数据与模型加密密钥存放在持久卷
- Vitest

## 本地开发

需要 Node.js 22.13 或更新版本（使用内置 node:sqlite）。

```bash
npm install
npm run dev
```

打开 http://localhost:3000 。

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm start
```

`npm start` 监听 3300，和服务器上的端口一致。

## 环境变量

样例在 `.env.example`。本地开发可不设置访问密码；生产环境必须配置 `OPENDOT_PASSWORD`，否则仅显示初始化提示。建议使用随机生成的长密码。

| 变量 | 作用 |
| --- | --- |
| `DATA_DIR` | SQLite 和模型加密密钥目录。本地默认 `./data`，容器里是 `/data`。 |
| `PORT` | 生产端口，容器里是 3300。 |
| `OPENAI_BASE_URL` | OpenAI 兼容 API 地址，默认 `https://api.deepseek.com/v1`。 |
| `OPENAI_API_KEY` | 留空就是演示模式。环境变量会优先于设置页。 |
| `OPENAI_MODEL` | 模型名，默认 `deepseek-flash`。 |
| `OPENDOT_PASSWORD` | 生产环境必填的访问密码。使用 HttpOnly、SameSite=Strict 会话 Cookie，修改密码会使既有登录失效。 |

## 部署

这台服务器的 Docker 没有 Buildx，`docker compose up --build` 会失败。用下面两条：

```bash
sudo DOCKER_BUILDKIT=0 docker build -t opendot:local .
sudo docker compose up -d --no-build
```

浏览器打开 http://服务器:3300 。健康检查是 http://服务器:3300/api/health 。GitHub Actions 在自己的机器上构建镜像再载入，不依赖服务器上的 Buildx。

这台机器上的 Caddy（80/443）、Uptime Kuma（13001）、Portainer（127.0.0.1:9000）和 sub2api（127.0.0.1:8080）不要动。OpenDot 只绑定 `0.0.0.0:3300`。`ec2-user` 需要用 `sudo` 才能访问 Docker。

数据卷名是 `opendot-data`。重新构建不会删它。

## CI/CD

工作流在 `.github/workflows/ci.yml`。每次推送和拉取请求都会跑检查；推到 `main`，或在 Actions 里手动 Run workflow 并勾选部署，才会发布。

- 检查：lint、类型检查、测试、构建。npm 依赖走 Actions 缓存。测试覆盖率写在该任务的 Summary 里。
- 密钥扫描：同一次运行用 gitleaks 扫仓库历史。扫到密钥就失败，并且不会部署。
- 镜像：在 GitHub 上构建，标签是完整 commit SHA，同时打上 `opendot:local`。构建层缓存放在 Actions cache。服务器没有 Buildx，所以不在服务器上编译。
- 部署互斥：生产部署共用一个队列，后一次会等前一次结束，不会两个一起改容器。
- 健康检查：只在这台机器上请求 `http://127.0.0.1:3300/api/health`，要看到 `ok: true` 和 `app: opendot`。失败时把 `opendot:local` 指回部署前标好的 `opendot:rollback`，再启动一次，然后这次任务记为失败。
- 清理：只删除较旧的 `opendot:<sha>` 标签，保留最近 5 个，以及正在使用的镜像和 `opendot:rollback`。不会 prune 其他项目的镜像，也不会动其他容器。
- 依赖更新：Dependabot 每周为 npm 和 GitHub Actions 开拉取请求。

仓库密钥是 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`。不要把私钥或 API Key 提交进仓库。

## 对话与模型配置

登录后在「设置 → 模型提供商」填写 Base URL、模型名和 API Key，保存后返回小点对话。
密钥使用 AES-256-GCM 加密保存，API 只返回是否已配置。填写空密钥会保留原值，勾选清除可以恢复演示模式。
环境变量逐项优先于设置页。生产环境的环境变量文件应仅允许服务管理员读取。

- Enter 发送，Shift + Enter 换行，中文输入法选词时不会误发送。
- 消息以请求 ID 去重。重复提交不会生成第二轮，失败时可以重试最后一条消息。
- 同一时间只生成一条回复。刷新页面会读取已保存的部分回复并跟踪状态，打开页面不会自动调用模型。
- 默认带入最近最多 20 个成功回合，上下文文字上限 48000 字符。用户单条消息上限 8000 字符。
- 模型请求 90 秒超时。服务重启后超过 120 秒无进展的回复会标记中断，可以重试。
- 当前版本是一位服务所有者、一个主 Dot 的文字会话。工具执行、群聊和多用户 ACL 按路线图推进。

备份时保存整个数据卷，包含聊天 SQLite、`dots.sqlite`、`work.sqlite`、`channels.sqlite`、`memory.sqlite`、对应的 WAL 和 `settings.key`。加密密钥与数据库应一起备份。
公网访问建议由 HTTPS 入口承载。应用的 HTTP 端口与既有部署一致，为 3300。
