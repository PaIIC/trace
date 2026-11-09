# 研迹 Trace

记录科研灵感的网页应用：打开即输入，提交时自动记录时间，沿时间线回看，每条记录拥有独立的 AI 分析页面。

## 已实现

- 首页自动弹出输入框，支持 `Ctrl / ⌘ + Enter` 保存；按 `N` 新建，`Ctrl / ⌘ + K` 搜索。
- 原文、关键词和服务端时间戳保存到数据库，刷新或重启服务后仍然保留。时间戳存储为 UTC，网页按浏览器时区显示。
- 按日期和时间展示灵感轨迹，支持搜索、关键词筛选、时间排序、分析状态筛选和收藏。
- 详情页保留原文，展示 AI 提炼的研究问题、潜在价值、可行路径、局限和下一步建议。
- 时间线、收藏列表和详情页均可「编辑」已保存的想法及关键词。可选择「保存修改」或「保存并重新分析」；保留记录 ID、原始时间和收藏状态。旧分析标记为待更新，重新分析失败时保留修改及旧分析，成功后替换。关闭未保存的编辑会提示确认；保存失败保留草稿，多页面修改冲突时可查看最新内容再继续。
- 点击卡片或详情页的「历史版本」，可查看每次修改前的想法、关键词、AI 分析及分析时间、模型。恢复时将所选内容和分析保存为新版本，保留恢复前的版本与全部历史，原始创建时间和当前收藏状态不变；不会自动调用模型。历史从启用此功能后开始累积，无法补回此前未留存的修改。
- 在网页「AI 连接设置」中接入 DeepSeek，填写密钥、选择模型、测试与保存，无需修改服务端配置；同时保留环境变量中的 OpenAI 兼容接口作为后备配置。未配置时保存为「待分析」，之后可以补充分析。分析失败或超时不影响原文；重新分析失败时保留之前成功的结果。
- 导出全部记录、分析和历史版本为 JSON；时间线和收藏列表的每张灵感卡片均有「删除」入口，详情页也可删除。确认框显示对应的标题和时间，确认后删除该灵感及其分析和历史，统计同步更新；失败时可重试。导出文件供备份与外部处理使用，目前未提供导入功能。
- 当前标签页的未提交草稿暂存于 `sessionStorage`；草稿不是正式记录，关闭标签页可能清除草稿。
- 适配桌面与手机，使用原生模态对话框，支持键盘操作与减少动画的系统偏好。

没有预置虚构的用户记录或 AI 分析。实际调用模型需要自行配置服务。

## 本地运行

本地运行需要 **Node.js 22.13.0 或以上**和 npm。以下以 Node.js 22.x 最新补丁版为例；如果已经装好符合要求的版本，可以跳过 Node.js 安装步骤。首次建空库时才运行 `db:setup`；如果要沿用旧电脑的笔记，请先看[迁移已有笔记](#迁移已有笔记)。

### Windows 11: 安装依赖环境和运行

以下步骤适用于 Intel 或 AMD 的 x64 电脑。

1. 打开 [Node.js 官方下载页](https://nodejs.org/en/download)，选择 **22.x → Windows → x64**，下载 Windows Installer（`.msi`）。双击安装，保留默认的 npm 和 PATH 选项。安装后重新打开 PowerShell，执行：

   ```powershell
   node -v
   npm.cmd -v
   ```

2. 在[项目仓库](https://github.com/PaIIC/trace)点击 **Code → Download ZIP** 并解压，或使用已有的 Git 工作目录。

3. 在这个 PowerShell 窗口逐行执行，等上一条成功后再运行下一条：

   ```powershell
   npm.cmd run install:ci
   npm.cmd run build
   npm.cmd run db:setup  # 仅首次创建空数据库时执行
   npm.cmd run dev -- --port 5173 --hostname 127.0.0.1
   ```

4. 保持窗口开启，在浏览器打开 <http://127.0.0.1:5173/>。按 `Ctrl+C` 停止服务；下次在同一目录只需执行最后一条 `npm.cmd run dev` 命令（含端口和地址参数）。

如果启动时提示缺少 `VCRUNTIME140.dll` 或 `MSVCP140.dll`，安装[微软官方 Visual C++ x64 运行库](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)后重试报错的步骤。

### Linux：安装 Node.js

项目所用的 [Cloudflare workerd](https://github.com/cloudflare/workerd/blob/v1.20260515.1/README.md#running-workerd) 在 Linux 上要求 glibc 2.35 或以上，例如 Ubuntu 22.04 或 Debian 12。以下命令适用于 Bash，使用 [nvm](https://github.com/nvm-sh/nvm/blob/v0.40.3/README.md#installing-and-updating) 将 Node.js 和 npm 安装到当前用户目录。

1. 如果尚未安装 nvm，运行以下命令，然后关闭并重新打开终端。如果提示找不到 `curl`，在 Ubuntu 或 Debian 上可先运行 `sudo apt update && sudo apt install curl ca-certificates`。

   ```bash
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   ```

2. 在重新打开的终端中安装并选用 Node.js 22，然后检查版本：

   ```bash
   nvm install 22
   nvm use 22
   node -v
   npm -v
   ```

   `node -v` 应显示 `v22.13.0` 或更高版本，`npm -v` 应显示版本号。如果你用 nvm 管理多个 Node.js 版本，在新终端启动本项目前可再次执行 `nvm use 22`。

### macOS：安装 Node.js 和命令行工具

1. 确认系统为 **macOS 13.5 或以上**。在终端运行 `xcode-select -p` 检查 Xcode 命令行工具；若提示未安装，运行 `xcode-select --install` 并按弹窗提示完成安装。无需安装完整的 Xcode。详见 [workerd 的运行要求](https://github.com/cloudflare/workerd/blob/v1.20260515.1/README.md#running-workerd)。
2. 在 [Node.js 官方下载页](https://nodejs.org/en/download)选择 **22.x → macOS**，下载 macOS Installer（`.pkg`）并按向导安装，它会同时安装 npm。如果需要选择架构，M 系列选 ARM64，Intel 选 x64。
3. 重新打开终端，分别运行 `node -v` 和 `npm -v`。两条命令都显示版本号后，继续下面的首次启动步骤。

### 首次启动（macOS 和 Linux）

下载或克隆[项目源码](https://github.com/PaIIC/trace)，将下面的示例路径换成包含 `package.json` 的实际目录。在终端逐行执行：

```bash
cd "/path/to/trace"
npm run install:ci
npm run build
npm run db:setup  # 仅首次创建空数据库时执行
npm run dev -- --port 5173 --hostname 127.0.0.1
```

在浏览器打开 <http://127.0.0.1:5173/>。按 `Ctrl+C` 停止服务；以后在同一目录只需执行最后一条启动命令。各平台首次本地访问都会自动完成模拟登录，无需另行创建账号。服务只监听本机地址，请勿直接暴露到公网。

### 迁移已有笔记

换电脑或操作系统时，先停止旧电脑上的服务，再把项目里的 `.wrangler/state/`（笔记、分析和历史版本）和 `.dev.vars`（解密已保存的 AI 连接所需的密钥）一起复制到新项目的相同位置。不要复制旧的 `node_modules`；在新电脑上按对应平台的步骤重新安装依赖、构建，并**跳过 `db:setup`**。同版本可以直接启动，旧版本数据库只需按顺序应用尚未执行的迁移。

如果从旧版本升级且数据库尚未包含 `ai_connections` 表，先构建，再只应用新增迁移：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_classy_thing.sql
```

旧版本已有 AI 连接表、但尚未升级编辑功能时，构建后只应用编辑迁移（本工作区已执行）：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_glorious_tiger_shark.sql
```

已有编辑功能的旧版本需要应用历史记录迁移（本工作区已执行）：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_illegal_captain_stacy.sql
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

本地启动会自动生成 `AI_SETTINGS_ENCRYPTION_KEY` 并保存在被 Git 忽略的 `.dev.vars` 中。Linux 和 macOS 上该文件仅当前用户可读写；Windows 上由文件的访问权限决定。**不要覆盖或删除该加密密钥**；迁移数据库时同时妥善备份它，否则需在网页重新填写 DeepSeek 密钥。托管部署需由部署者预先设置一个随机的 64 位十六进制 `AI_SETTINGS_ENCRYPTION_KEY` 平台密钥；不得使用 `NEXT_PUBLIC_` / `VITE_` 前缀或提交到代码仓库。

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
  api/ideas/                 保存、查询、编辑、历史、恢复、导出、收藏、删除与分析
  api/config/                读取、保存、移除 AI 连接与测试连接
components/notebook.tsx      网页交互与布局
components/notebook-parts.tsx 对话框、活动图等组件
components/ai-settings.tsx   DeepSeek 连接表单
components/idea-editor.tsx   编辑、冲突比较与保存表单
components/idea-history.tsx  历史版本预览与恢复确认
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

| 接口                          | 用途                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `GET /api/ideas`              | 读取当前用户的记录，时间倒序                                             |
| `POST /api/ideas`             | 保存 `{ id, content, tags }`                                             |
| `GET /api/ideas/:id`          | 读取详情                                                                 |
| `GET /api/ideas/:id/history`  | 读取当前版本及按版本号倒序排列的修改前记录 `{ idea, versions }`          |
| `POST /api/ideas/:id/restore` | 恢复 `{ versionRevision, revision, requestId }`，生成新版本              |
| `GET /api/ideas/export`       | 一次性导出 `{ app, version: 2, exportedAt, ideas, history }`             |
| `PATCH /api/ideas/:id`        | 编辑 `{ content, tags, revision }`，或单独修改 `{ bookmarked: boolean }` |
| `DELETE /api/ideas/:id`       | 删除记录、分析及所属历史版本                                             |
| `POST /api/ideas/:id/analyze` | 调用配置的 AI 并保存分析，可传 `{ revision }` 防止分析过期版本           |
| `GET /api/config`             | 获取模型、配置来源与密钥尾号，不返回密钥                                 |
| `POST /api/config`            | 保存 `{ provider: "deepseek", model, apiKey? }`；空密钥沿用已保存值      |
| `DELETE /api/config`          | 移除当前用户的网页连接配置                                               |
| `POST /api/config/test`       | 使用同样的请求体测试连接，不保存                                         |

保存与分析分成两个独立请求。网页保存成功后，如果 AI 已配置，会自动发起分析。没有配置的情况下，可以先持续记录，之后逐条补充分析。个人笔记的列表暂不分页，适合个人规模使用。

编辑请求使用读取时的 `revision`，修改内容或关键词时递增版本；相同内容的重复保存不会重复递增。过期版本修改返回 409，原时间戳和分析不能由客户端覆盖。编辑会使旧的分析任务失效，旧任务完成后不能覆盖新内容或新分析。修改后的旧分析仅在详情页作为待更新结果保留，不用于时间线标题、摘要和关键词筛选。

每次实际编辑或恢复前，将当前记录归档到 `idea_versions`。归档和修改使用同一 D1 批量事务，任一步失败均回滚，避免内容已覆盖却没有历史可恢复。历史为只读快照，包含当时的分析结果、模型、分析时间、过期标记和失败信息；单独收藏或重新分析不会生成内容版本。历史中较早的分析会明确标记，不冒充与该版内容对应的新分析。保存历史时尚未完成的分析不会在后台写入快照，恢复后可以重新生成。

恢复请求中的 `revision` 是用户当前查看的版本，`versionRevision` 是要恢复的历史版本，`requestId` 为一次恢复操作的 UUID，断网重试须沿用。恢复前先保留当前记录，再递增版本并复制历史内容及分析；保留最初的创建时间和当前收藏状态，取消旧分析任务。过期恢复请求返回 409，相同请求的重试不重复创建版本。归档、恢复、导出均按用户隔离；删除灵感通过外键一并清理其历史。历史列表目前一次性加载，适合个人笔记规模。

## 验证

```bash
npm run typecheck
npm test
npm run test:workers
npm run build
npx playwright install chromium
npm run test:e2e
```

- 数据测试直接使用迁移文件与 SQLite，覆盖保存、去重、时间顺序、用户隔离、收藏、删除、编辑冲突与重试、历史快照、恢复与幂等重试、事务失败回滚、历史导出与级联删除、分析并发、过期恢复和失败保留。
- AI 测试使用模拟服务响应验证请求格式、响应校验、鉴权失败、限流与网络失败；同时验证密钥加密、用户隔离、留空保留、替换、删除、损坏密钥恢复与环境变量后备；不消耗真实模型额度。
- Worker 回归测试在应用所用的实际运行时中执行连接测试与分析请求，模拟外部服务且禁用真实外网请求。覆盖运行时请求选项兼容性，以及拒绝跳转、避免把密钥转发到跳转目标。修改 AI 请求逻辑时应同时运行核心测试与 Worker 测试。
- 浏览器测试覆盖输入、时间线、详情直达、刷新、收藏、搜索、JSON 导出、断网草稿恢复、权限、DeepSeek 表单与手机布局。测试会清理自己生成的记录与测试连接，不删除已有笔记。保存连接测试发现已有配置时会跳过，避免覆盖密钥。
- 浏览器测试默认验证**尚未连接 AI**的环境；不要在已配置真实模型的实例上运行此套测试。AI 展示部分使用浏览器内的专用模拟数据，不写入数据库。
- `npx playwright test tests/history.spec.ts tests/editing.spec.ts tests/deletion.spec.ts` 可独立用于已有 AI 配置的实例：仅创建和清理测试记录，编辑与历史测试拦截模型生成请求，不修改连接或调用真实模型。覆盖编辑入口、保存刷新、取消修改、失败重试、冲突处理、重新分析、旧结果保护、版本查看与恢复、并发恢复、历史导出和手机布局。

Linux 上首次运行 Playwright 若提示缺失系统依赖，可按其提示安装。项目无需外部字体服务，默认使用系统中文字体。

## Git 与部署

项目目录本身是 Git 仓库，开发步骤已按初始化、数据与接口、界面和验证文档分阶段提交。

```bash
git status
git log --oneline
```

数据库、密钥、依赖、构建输出和浏览器测试产物均被 Git 忽略，不随项目源码分发。

`.openai/hosting.json` 已声明 D1 绑定 `DB`。Sites 托管应使用私有站点，在平台配置上述加密密钥后即可在网页填写 DeepSeek 连接；其他兼容服务仍可使用平台环境变量。保留平台认证头与每条记录的用户隔离。平台会应用已提交的数据库迁移。

本次创建线上站点时连接器发生网络连接错误，未取得站点 ID；恢复连接后查询得到的站点列表为空。目前已完成本地版本，尚未注册或发布线上站点，没有公开访问地址。
