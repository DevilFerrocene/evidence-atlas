# Literature collection module

Atlas 的文献采集模块，负责浏览器访问、正文与参考文献提取、PDF/图片下载和访问诊断。源码在 `browser/` 与 `src/`；共享来源缓存和分析成果由 Atlas 管理。

统一入口：在 Atlas 根目录运行 `npm run literature -- --workspace /absolute/workspace`。该入口先使用共享本地缓存，再调用模块的 MCP 采集服务。

浏览器运行于 Docker Compose 服务。`LITERATURE_STATE_DIR` 指定运行数据目录，`LITERATURE_ENV_FILE` 指定外部环境配置文件。未设置时，入口沿用同级 `Scientist-literature-browser-mcp` 目录中的现有运行数据和环境配置。凭据与浏览器状态不属于源码。

在 Atlas 根目录运行 `npm run test:smoke` 检查本地库、分析版本、模块源码、阅读器接口和 MCP 缓存调用链。该测试使用临时工作区和模拟上游，不访问出版商。
