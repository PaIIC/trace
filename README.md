# 研迹 Trace

记录科研灵感的网页应用：打开即输入，提交时自动记录时间，沿时间线回看，每条记录拥有独立的 AI 分析页面。

## 已实现

- 首页自动弹出输入框，支持 `Ctrl / ⌘ + Enter` 保存；按 `N` 新建，`Ctrl / ⌘ + K` 搜索。
- 原文、关键词和服务端时间戳保存到数据库，刷新或重启服务后仍然保留。时间戳存储为 UTC，网页按浏览器时区显示。
- 按日期和时间展示灵感轨迹，支持搜索、关键词筛选、时间排序、分析状态筛选和收藏。
- 详情页保留原文，展示 AI 提炼的研究问题、潜在价值、可行路径、局限和下一步建议。
- 在网页「AI 连接设置」中接入 DeepSeek，填写密钥、选择模型、测试与保存，无需修改服务端配置；同时保留环境变量中的 OpenAI 兼容接口作为后备配置。未配置时保存为「待分析」，之后可以补充分析。分析失败或超时不影响原文；重新分析失败时保留之前成功的结果。
- 导出全部记录与分析为 JSON；删除需要确认。导出文件供备份与外部处理使用，目前未提供导入功能。
- 当前标签页的未提交草稿暂存于 `sessionStorage`；草稿不是正式记录，关闭标签页可能清除草稿。
- 适配桌面与手机，使用原生模态对话框，支持键盘操作与减少动画的系统偏好。

没有预置虚构的用户记录或 AI 分析。实际调用模型需要自行配置服务。

## 本地运行

需要 Node.js **22.13 或以上**。所有命令都在本项目目录运行。

```bash
cd /home/yifan_wsl/rescnote/trace
npm ci
npm run build
npm run db:setup
npm run dev -- --port 5173 --hostname 127.0.0.1
```

打开 <http://127.0.0.1:5173/>。首次本地访问会由开发环境完成模拟登录，无需另行创建账号。本地开发服务只监听回环地址，请勿直接暴露到公网。

`db:setup` **仅在第一次创建空数据库时运行**，会依次应用所有迁移。本次开发已完成数据库初始化与 AI 连接表升级，直接执行 `npm run dev -- --port 5173 --hostname 127.0.0.1` 即可再次启动。已有数据库上重复执行初始建表会提示表已存在，不会删除数据。后续新增结构应生成新的迁移并按顺序应用，不能重放已经执行的迁移。

如果从旧版本升级且数据库尚未包含 `ai_connections` 表，先构建，再只应用新增迁移：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_classy_thing.sql
```

本地数据库存放在 `.wrangler/state/`，已被 Git 忽略。不要删除此目录，否则会丢失本地记录。备份时使用网页的导出按钮；如需复制整个数据库目录，应先停止开发服务。部署后的数据库与本地数据库相互独立。

## 连接 AI

### 在网页接入 DeepSeek

1. 点击侧边栏「AI 连接设置」。
2. 从 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取 API Key，粘贴到密钥输入框。
3. 选择模型。预置 `deepseek-flash` 与 `deepseek-v4-pro`，也可以填写自定义模型名称。
4. 点击「测试连接」验证密钥和所选模型，再点击「保存连接」。测试成功本身不会保存配置；也可以直接保存，之后再测试。

保存后立即生效，无需重启。新灵感自动分析，已有灵感可在详情页补充分析。再次打开设置时只显示密钥尾号；留空保存可沿用原密钥，填写新值可替换。「移除连接」只删除这份连接配置，保留全部笔记与分析；如有原来的环境变量配置，会恢复使用该配置。

服务地址固定为 DeepSeek 官方地址 `https://api.deepseek.com`。测试通过服务端请求 `GET /models` 检查密钥和模型，不上传灵感、不生成内容；不保证账户余额充足或后续推理一定成功。分析请求使用非思考模式与 JSON 输出，适合简短的初步分析。接口依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/api/create-chat-completion/) 与 [模型列表接口](https://api-docs.deepseek.com/api/list-models/)。

网页填写的密钥通过同源 API 发送到服务端，使用 AES-GCM 加密后按当前用户保存到数据库。读取配置只返回模型、来源和密钥尾号，不回传完整密钥或密文。密钥不进入浏览器存储、灵感导出文件或 Git。关闭设置会清空尚未保存的密钥输入。生成分析时，原始灵感内容会发送给 DeepSeek。

本地启动会自动生成 `AI_SETTINGS_ENCRYPTION_KEY` 并保存在被 Git 忽略的 `.dev.vars` 中，文件权限为仅当前用户可读写。**不要覆盖或删除该加密密钥**；迁移数据库时同时妥善备份它，否则需在网页重新填写 DeepSeek 密钥。托管部署需由部署者预先设置一个随机的 64 位十六进制 `AI_SETTINGS_ENCRYPTION_KEY` 平台密钥；不得使用 `NEXT_PUBLIC_` / `VITE_` 前缀或提交到代码仓库。

### 其他 OpenAI 兼容服务（可选）

在现有 `.dev.vars` 中添加以下字段，保留自动生成的加密密钥：

```dotenv
AI_BASE_URL="https://your-provider.example/v1"
AI_MODEL="your-model-name"
AI_API_KEY="your-api-key"
```

`AI_BASE_URL` 是 `/chat/completions` 之前的地址，应用会自动追加该路径。不同服务的地址是否包含 `/v1`，应以对应服务说明为准。使用 HTTPS；本机兼容服务可以使用 `http://127.0.0.1:端口`。配置完成后重启开发服务，再打开网页「AI 连接设置」。当没有网页保存的 DeepSeek 配置时，使用此后备服务。连接状态只表示配置完整，实际分析会验证服务可用性和密钥权限。

密钥仅由服务端读取，不会传给浏览器、写入灵感导出文件或提交到 Git。不要将密钥放入任何 `NEXT_PUBLIC_` / `VITE_` 变量。

请求遵循 `POST /chat/completions` 的 `model` 与 `messages` 格式，解析 `choices[0].message.content` 中的 JSON。没有绑定某一家供应商或模型。分析包括：

```json
{
  "title": "概括标题",
  "summary": "灵感概述",
  "question": "核心研究问题",
  "value": "潜在价值与待验证假设",
  "approach": "可行路径与局限",
  "nextSteps": ["具体下一步"],
  "keywords": ["研究关键词"]
}
```

单次模型请求最多等待 60 秒，同一条记录使用 90 秒分析锁避免重复调用；意外中断后可以重试。AI 不负责真实文献检索或事实认证，提示词明确要求标注待验证假设。

## 技术结构

使用 React 19、TypeScript、Vinext / Vite、Cloudflare D1（本地由 SQLite 模拟），保留 Sites 的认证与构建集成。

```text
app/                         页面与 API 路由
  page.tsx                   时间线首页
  ideas/[id]/page.tsx         灵感详情
  api/ideas/                 保存、查询、收藏、删除与分析
  api/config/                读取、保存、移除 AI 连接与测试连接
components/notebook.tsx      网页交互与布局
components/notebook-parts.tsx 对话框、活动图等组件
components/ai-settings.tsx   DeepSeek 连接表单
lib/domain.ts                数据结构与输入、模型响应校验
lib/ideas-repository.ts       持久化、用户隔离、分析锁
lib/ai.ts                    模型服务适配与提示词
lib/ai-connections.ts         加密存储、用户隔离、配置解析与连接测试
lib/server.ts                登录、来源检查、请求处理
db/schema.ts                 数据表定义
drizzle/                     SQL 迁移与元数据
tests/                       数据/API 适配测试与浏览器测试
```

API 均要求登录，并按用户 ID 隔离记录。服务端生成创建时间，不接受客户端覆盖；客户端生成 UUID，重复提交相同 UUID 不会创建多条记录。写入请求检查来源，输入有长度上限，模型输出经过结构校验。删除不影响其他记录。

| 接口                          | 用途                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| `GET /api/ideas`              | 读取当前用户的记录，时间倒序                                        |
| `POST /api/ideas`             | 保存 `{ id, content, tags }`                                        |
| `GET /api/ideas/:id`          | 读取详情                                                            |
| `PATCH /api/ideas/:id`        | 修改 `{ bookmarked: boolean }`                                      |
| `DELETE /api/ideas/:id`       | 删除记录与分析                                                      |
| `POST /api/ideas/:id/analyze` | 调用配置的 AI 并保存分析                                            |
| `GET /api/config`             | 获取模型、配置来源与密钥尾号，不返回密钥                            |
| `POST /api/config`            | 保存 `{ provider: "deepseek", model, apiKey? }`；空密钥沿用已保存值 |
| `DELETE /api/config`          | 移除当前用户的网页连接配置                                          |
| `POST /api/config/test`       | 使用同样的请求体测试连接，不保存                                    |

保存与分析分成两个独立请求。网页保存成功后，如果 AI 已配置，会自动发起分析。没有配置的情况下，可以先持续记录，之后逐条补充分析。个人笔记的列表暂不分页，适合个人规模使用。

## 验证

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

- 数据测试直接使用迁移文件与 SQLite，覆盖保存、去重、时间顺序、用户隔离、收藏、删除、分析并发、过期恢复和失败保留。
- AI 测试使用模拟服务响应验证请求格式、响应校验、鉴权失败、限流与网络失败；同时验证密钥加密、用户隔离、留空保留、替换、删除、损坏密钥恢复与环境变量后备；不消耗真实模型额度。
- 浏览器测试覆盖输入、时间线、详情直达、刷新、收藏、搜索、JSON 导出、断网草稿恢复、权限、DeepSeek 表单与手机布局。测试会清理自己生成的记录与测试连接，不删除已有笔记。保存连接测试发现已有配置时会跳过，避免覆盖密钥。
- 浏览器测试默认验证**尚未连接 AI**的环境；不要在已配置真实模型的实例上运行此套测试。AI 展示部分使用浏览器内的专用模拟数据，不写入数据库。

Linux 上首次运行 Playwright 若提示缺失系统依赖，可按其提示安装。项目无需外部字体服务，默认使用系统中文字体。

## Git 与部署

项目目录本身是 Git 仓库，开发步骤已按初始化、数据与接口、界面和验证文档分阶段提交。

```bash
git status
git log --oneline
```

数据库、密钥、依赖、构建输出和浏览器测试产物均被忽略。当前仅有本地 Git 历史，未配置个人 GitHub 远程仓库。

`.openai/hosting.json` 已声明 D1 绑定 `DB`。Sites 托管应使用私有站点，在平台配置上述加密密钥后即可在网页填写 DeepSeek 连接；其他兼容服务仍可使用平台环境变量。保留平台认证头与每条记录的用户隔离。平台会应用已提交的数据库迁移。

本次创建线上站点时连接器发生网络连接错误，未取得站点 ID；恢复连接后查询得到的站点列表为空。目前已完成本地版本，尚未注册或发布线上站点，没有公开访问地址。
