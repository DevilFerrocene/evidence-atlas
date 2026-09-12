# Evidence Atlas · 循证

本地论文阅读器与材料处理 agent。网页展示已落盘的中英正文、图像区域和证据链；agent 负责读取材料、生成结构化数据、校验和发布。

## 本地运行

需要 Node.js 22.13 或更新版本。

```sh
npm ci
npm run init -- --examples
npm start
```

打开 [本地阅读器](http://127.0.0.1:4317)。`init --examples` 将示例复制到文献库，已有同名论文时拒绝覆盖；只建空工作区用 `npm run init`。网页运行不需要模型或 API Key。

```text
apps/reader/public/   浏览器前端
apps/reader/server.mjs 只读 HTTP 服务
agent/               MCP、独立 loop、材料处理工具
packages/core/       校验与文献发布
schemas/             数据契约
examples/library/    随包示例
workspace/           本地工作区，不进入 Git 或发行包
  runs/              每次任务的输入、草稿、来源、状态
  library/papers/    已发布 JSON
  library/sources/   已发布本地来源
```

设置 `EVIDENCE_WORKSPACE=/absolute/path/workspace` 可让阅读器和 agent 共用另一个工作区。`PORT=4318 npm start` 更换网页端口。`EVIDENCE_DATA_DIR` 仅用于 CLI／阅读器连接外部文献库；agent 发布到其工作区的 `library/`。

## 接入 Codex 等 harness

MCP 通过 stdio 提供工具，模型由 harness 提供。服务的标准输出专用于 MCP 协议。

```sh
codex mcp add evidence-atlas -- node /absolute/path/evidence-atlas/agent/mcp.mjs \
  --workspace /absolute/path/workspace
```

命令格式见 [Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。其他支持 stdio 的客户端可使用：

```json
{
  "mcpServers": {
    "evidence-atlas": {
      "command": "node",
      "args": ["/absolute/path/evidence-atlas/agent/mcp.mjs", "--workspace", "/absolute/path/workspace"]
    }
  }
}
```

[SKILL.md](SKILL.md) 是同一工作流的 skill 入口。可把整个仓库放进 harness 的 skill 目录，或建立指向仓库的目录链接；仅复制 SKILL.md 时还需要原项目提供工具、契约和阅读器。没有 MCP 的 harness 也可依 skill 调用本项目 CLI。MCP 的 `atlas_read_contract` 提供 skill 与 JSON Schema。

工具涵盖工作区文件读写、公开网页、PDF 文本与页面渲染、图像查看与裁剪、论文校验、观点读取和文献发布。工具写入任务草稿，发布工具才写文献库。网页不提供模型调用、任务写入或密钥接口。

## 独立 agent

内置最简工具循环使用 OpenAI 兼容的 Chat Completions API。模型需支持 function/tool calling；读图还需支持图片输入。配置保存在用户目录 `~/.config/evidence-atlas/agent.json`，不放入仓库：

```json
{
  "base_url": "https://your-provider.example/v1",
  "model": "your-tool-capable-model",
  "api_key": "your-api-key"
}
```

也可用 `EVIDENCE_BASE_URL`、`EVIDENCE_MODEL` 和 `EVIDENCE_API_KEY`（或 `OPENAI_API_KEY`）。`--config /absolute/path/agent.json` 指定其他配置文件。

```sh
npm run agent -- \
  --task "阅读提供的论文，生成中英助读与有据可查的观点，发布到本地文献库。" \
  --input /absolute/path/paper.pdf \
  --max-turns 20
```

`--input` 可重复；也支持 `--task-file`、`--model`、`--base-url`、`--workspace` 和 `--timeout-ms`。每次运行的状态和工具结果保存在 `workspace/runs/`，Ctrl+C 取消。只有校验和发布实际完成后才返回成功；达到轮数上限、模型提前结束或请求失败都会留下明确终态。发布后刷新网页即可读取，无需重启服务。

PDF 工具按页提取文本，也可渲染页面供模型看图；扫描页的空文本会明确返回。材料中的指令按来源内容处理。材料读取与生成质量取决于所选模型和实际取得的内容。

## 数据导入与导出

```sh
npm run validate -- /absolute/path/paper.json
npm run import -- /absolute/path/paper.json --source-dir /absolute/path/bundle
npm run export -- paper-id /absolute/path/empty-output
```

本地来源字段采用 `sources/<filename>`，`--source-dir` 指向包含 `sources/` 的目录。替换论文需要 `--replace`。发布时先校验并复制来源，再原子落盘论文 JSON；来源使用独立版本文件名，未完成的草稿不会出现在网页。数据契约为 [paper.schema.json](schemas/paper.schema.json)。

只读接口包括 `/api/papers`、`/api/papers/:id`、`/api/papers/:id/claims/:claimId`、`/api/papers/:id/sources/:sourceId`、`/api/papers/:id/export`、`/api/schema` 与 `/api/health`。服务仅监听 `127.0.0.1`，不提供工作区草稿、运行日志或配置文件。

## 打包

```sh
npm pack
```

包内包含网页、agent、skill、数据契约和示例。解压后执行 `npm install`，再按本地运行步骤初始化；本地工作区、配置和密钥不随包分发。

## 许可

代码、skill 和原创示例采用 [MIT](LICENSE)。第三方论文、原图与译文按各自许可使用，来源见各论文 JSON。示例包含 Einstein 历史论文、两篇明确标识的人为构造稿，以及 Mulloyarova 等人的 2020 年开放获取论文（CC BY 4.0）。
