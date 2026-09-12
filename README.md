# Evidence Atlas · 循证

本地双语论文阅读器。划线片段对应结构化观点；详情展示 AI 整理的结论、证据分支、定位、来源链接与未解决问题。英文例文采用公版全文，中文为本例 AI 翻译。

## 运行

需要 Node.js 22 或更新版本。在本目录运行：

```sh
npm ci
npm start
```

打开终端给出的地址，默认 `http://127.0.0.1:4317`。服务仅监听本机。`PORT=4318 npm start` 可指定端口；`EVIDENCE_DATA_DIR=/absolute/path/papers npm start` 可指定论文数据目录，同一变量也适用于 CLI。对应的本地来源放在该目录的同级 `sources/` 中。停止使用终端的 Ctrl+C。

`dist/` 是原生 HTML、CSS、JavaScript 前端；`server/` 是 Node.js 后端；`data/papers/` 是经校验的 JSON 文献库。KaTeX、字体及数据均从本地提供；查阅外部参考链接需要网络。没有页面内模型调用：执行调查的 agent 按 [SKILL.md](SKILL.md) 制作数据，后端负责校验和提供接口。

## 阅读

切换中文或 English。悬停/键盘聚焦划线文字查看详情，点击或 Enter 固定，Escape 关闭；触屏直接点按。一个片段有多个观点时，在详情顶部选择。默认先显示直接结论、判断理由和从基础依据到当前观点的连贯解释。证据图、精确计算与补充发现位于次级展开区，参考文献位于其中更低一层。详情保持打开，可把鼠标移进去滚动或访问来源。蓝色、虚线、点线标识不同证据状态，具体判断见文字。统计的是标注覆盖，不是观点正确率。

## 数据与接口

数据契约：[schemas/paper.schema.json](schemas/paper.schema.json)。本文正文采用片段对象，稳定 ID 在中英之间共用，不依赖翻译后字符偏移。多个片段与多个观点可以互相关联。`evidence.depends_on` 是可共享的有向无环图，真实循环引用通过 `findings` 与未解决节点记录。标签概括状态，正文解释实际发现。

| 读取接口 | 内容 |
| --- | --- |
| `GET /api/health` | 服务状态与文献数 |
| `GET /api/papers` | 文献与标注统计 |
| `GET /api/papers/:id` | 全文及完整证据数据 |
| `GET /api/papers/:id/claims/:claimId` | 当前观点及其全部证据依赖与来源 |
| `GET /api/papers/:id/sources/:sourceId` | 来源详情 |
| `GET /api/papers/:id/export` | 下载该文 JSON |
| `GET /api/schema` | JSON Schema |

导入与独立交付：

```sh
node scripts/cli.mjs validate /absolute/path/paper.json
node scripts/cli.mjs import /absolute/path/paper.json
node scripts/cli.mjs export einstein-1905-inertia-energy /absolute/path/empty-output
```

带 `local_path` 的来源使用 `sources/<filename>`。导入文件与 `sources/` 通常位于同一目录，或以 `--source-dir` 指定包含 `sources/` 的基目录。同名论文默认拒绝覆盖；`--replace` 显式替换。导入后重启服务。网页下载仅含 JSON；CLI 导出同时携带本地来源。

## 例文

Albert Einstein (1905), *Does the Inertia of a Body Depend upon its Energy-Content?*, Annalen der Physik 18, 639–641. [原刊 DOI](https://doi.org/10.1002/andp.19053231314) · [公版英译](https://www.fourmilab.ch/etexts/einstein/E_mc2/www/)

例文 JSON 包含论文完整正文、公式与脚注；电子版编辑说明放入版本信息。证据链区分原文引用、倒查补充、后续理论和后来实验。对未取得的 Stachel–Torretti 1982 原文保留访问缺口，引用其讨论的范围只到已核读的 Ohanian 预印本。

本框架和 skill 可整体搬运到其他 agent 工作目录；入口为 [SKILL.md](SKILL.md)。它们不依赖 Codex 专用工具。文献原文与各来源保留自己的版权归属；具体全文使用依据见数据中的 `paper.rights`。
