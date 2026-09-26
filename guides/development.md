# 开发指南

## 目录与修改位置

| 位置 | 用途 |
| --- | --- |
| `apps/stage-tamagotchi/src/main` | Electron 生命周期、系统服务、窗口和主进程 |
| `apps/stage-tamagotchi/src/preload` | 受控的主进程/渲染器桥接 |
| `apps/stage-tamagotchi/src/shared` | Electron Eventa 合同和纯状态逻辑 |
| `apps/stage-tamagotchi/src/renderer` | 桌面页面和应用入口 |
| `packages/stage-ui` | 聊天、Provider、能力模块、记忆和业务组件 |
| `packages/stage-pages` / `stage-layouts` | 共享设置页面与布局 |
| `packages/stage-ui-live2d` / `stage-ui-three` | Live2D 与 VRM / 3D 渲染 |
| `packages/ui` / `packages/i18n` | UI 基础组件与语言资源 |
| `packages/electron-*` | Electron IPC、窗口与截图工具 |
| `packages/server-*` | 客户端通信 SDK、协议与共享类型 |

工作区依赖使用 `workspace:` 链接，本地源码就在本仓库。其他依赖由 pnpm 根据清单与锁文件安装。保留包名中的 `@proj-airi` 可以让现有引用一致；产品名称与工作区技术名称并不要求相同。

## 常用命令

以下命令均在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm check:dev
pnpm dev
pnpm build:packages
pnpm build:source
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm -F @proj-airi/stage-ui typecheck
pnpm typecheck:safe
pnpm lint
pnpm test:run:safe -- path/to/example.test.ts
```

`build:packages` 编译需要构建的共享包；`typecheck:safe` 限制工作区并发，减少内存压力。生成的 `dist`、路由声明、`out` 等文件可以在本地重新生成，不提交它们。

`test:run:safe` 默认排除使用真实 OpenRouter 密钥的外部集成文件，并限制测试并发。需要真实供应商测试时，先核对密钥、网络与费用，再显式使用普通测试命令执行该文件。

编译桌面源码使用 `pnpm build:source`，依次准备共享包、类型检查和编译 Electron / 渲染器，不生成安装包。该命令提高编译进程的 Node 堆上限，避免默认约 2 GiB 的堆在处理渲染器资源时耗尽；如果已设置 `NODE_OPTIONS` 的堆大小，将保留你的值。完整编译建议使用至少 8 GB 内存的开发机器。

真实窗口启动使用 `pnpm dev`。初次类型检查若缺少自动路由声明，应先完成开发配置的编译或启动，使路由插件生成声明。

## 修改与验证

- 在最小相关包中修改；公共类型和纯逻辑放在共享包，桌面系统操作留在主进程。
- 保持 Eventa IPC 的数据可序列化，不广播 Promise、函数、Proxy 或 AbortSignal。
- 多窗口修改同一持久化数据时检查 scope、版本与写入顺序；旧异步回调不得覆盖新会话。
- 涉及模型调用的测试使用 mock 或本地测试服务；明确配置的外部集成测试可能产生供应商费用。
- 先运行对应测试与类型检查，再检查 diff。`lint:fix` 会修改文件，运行后仍需审查。

更换依赖时更新清单和锁文件。不要只修改锁文件中的版本号，也不要为消除编译错误把类型强制转为 `any`。
