# OpenDot

自托管的个人 AI 助手和团队。界面是简体中文。

这个仓库按天推进，不要一次把规格做完。今天是第 1 天：能打开的中文骨架、检查和部署。后续每天做什么写在 [docs/ROADMAP.md](docs/ROADMAP.md)。

没有配置模型时应用也要能打开。模型接入排在第 12 天，现在还不会回复。

## 技术栈

- Next.js 15、React 19、TypeScript
- Tailwind CSS 4
- Docker Compose，数据卷留给后面的 SQLite
- Vitest

## 本地开发

需要 Node.js 22。

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

样例在 `.env.example`。第 1 天都可以留空。

| 变量 | 作用 |
| --- | --- |
| `DATA_DIR` | 以后的 SQLite 目录。本地默认 `./data`，容器里是 `/data`。 |
| `PORT` | 生产端口，容器里是 3300。 |
| `OPENAI_BASE_URL` | 第 12 天使用。OpenAI 兼容地址，例如 `https://api.openai.com/v1`。 |
| `OPENAI_API_KEY` | 留空就是演示模式。环境变量会优先于设置页。 |
| `OPENAI_MODEL` | 模型名，默认 `gpt-4o-mini`。 |
| `OPENDOT_PASSWORD` | 可选。设置后才要求登录。现在还没有登录页。 |

## 部署

这台服务器的 Docker 没有 Buildx，`docker compose up --build` 会失败。用下面两条：

```bash
sudo DOCKER_BUILDKIT=0 docker build -t opendot:local .
sudo docker compose up -d --no-build
```

浏览器打开 http://服务器:3300 。健康检查是 http://服务器:3300/api/health 。GitHub Actions 在自己的机器上构建镜像再载入，不依赖服务器上的 Buildx。

这台机器上的 Caddy（80/443）、Uptime Kuma（13001）、Portainer（127.0.0.1:9000）和 sub2api（127.0.0.1:8080）不要动。OpenDot 只绑定 `0.0.0.0:3300`。`ec2-user` 需要用 `sudo` 才能访问 Docker。

数据卷名是 `opendot-data`。重新构建不会删它。

## GitHub Actions

`.github/workflows/ci.yml`：

- 拉取请求和推送：lint、类型检查、测试、构建
- 推到 `main`：在 GitHub 上构建镜像，传到服务器后 `sudo docker load`，再 `sudo docker compose up -d --no-build`

仓库密钥：

| 密钥 | 内容 |
| --- | --- |
| `DEPLOY_HOST` | 服务器地址 |
| `DEPLOY_USER` | SSH 用户，例如 `ec2-user` |
| `DEPLOY_SSH_KEY` | 部署私钥全文 |

没有这三项时，检查任务仍会跑，部署任务会失败。不要把私钥或 API Key 提交进仓库。
