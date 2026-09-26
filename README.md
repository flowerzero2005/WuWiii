# WuWiii 开发端

WuWiii 是一个可自定义角色的桌面 AI 伙伴应用，使用 Electron、Vue 和 TypeScript。你可以配置自己的聊天模型、语音、听觉、视觉和联网搜索服务，使用 Live2D / VRM 角色、记忆、日记与群聊剧本。

这个仓库提供桌面客户端、必要的共享包、测试和开发工具。官方服务端、生产配置与用户数据不在仓库内。开发版使用独立的应用数据目录，默认云服务地址为本机回环地址，官方自动更新关闭。

## 开始开发

需要 **Node.js 22 LTS（至少 22.12）** 和 **pnpm 10.30.3**。首次安装还需访问依赖仓库；首次启动涉及 Live2D SDK 与示例角色资源下载。

```sh
corepack enable
corepack prepare pnpm@10.30.3 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Windows PowerShell 如果拦截 `pnpm.ps1`，将上面的 `pnpm` 写成 `pnpm.cmd`。桌面开发端固定使用 **5173** 端口；已有进程占用时先停止它。

启动后进入 **设置 → 服务商** 添加你自己的接口，再到 **机体模块 → 思考** 选择服务商与模型。使用自己的本地模型无需运行官方服务端。详见 [快速开始](guides/getting-started.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](guides/getting-started.md) | 安装、启动、配置第一个模型 |
| [开发指南](guides/development.md) | 目录、依赖、编译、测试与修改位置 |
| [使用指南](guides/user-guide.md) | 聊天、角色、语音、视觉、剧本与日记 |
| [配置与费用](guides/configuration.md) | 自配接口、环境变量、官方能力和费用边界 |
| [常见问题](guides/troubleshooting.md) | 依赖下载、模型、端口、诊断和性能问题 |
| [贡献与隐私](guides/contributing.md) | 提交改动、反馈问题、脱敏和许可证 |
| [仓库范围](DEVELOPMENT_REPOSITORY_SCOPE.md) | 包含内容、资源下载和未提供的服务 |

## 为什么源码仓库比安装包小

Git 仓库保存源码、必要素材、依赖声明和 `pnpm-lock.yaml`。`pnpm install` 根据锁文件安装第三方依赖，`postinstall` 编译共享包。`node_modules`、Electron 运行时下载缓存、编译输出、用户导入的模型和本地设置不提交到 Git；Git 还会压缩源码和素材。

因此仓库的几十 MB 与安装后的磁盘占用不同。依赖版本、内部工作区代码与下载入口必须完整；无需把几 GB 的本机依赖目录上传。

## 授权

WuWiii 基于 Project AIRI。保留原作者 Neko Ayaka 与 Project AIRI 的 MIT 授权，见 [LICENSE](LICENSE)。第三方字体、音频组件等授权见 [第三方声明](apps/stage-tamagotchi/build/WUWIII-THIRD-PARTY-NOTICES.txt)。Live2D SDK、角色模型和用户导入素材遵守各自授权，不能把它们的授权自动视为 MIT。
