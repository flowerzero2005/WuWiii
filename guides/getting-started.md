# 快速开始

## 1. 准备环境

安装 Node.js 22 LTS（至少 22.12），并启用仓库声明的 pnpm 10.30.3：

```sh
node --version
corepack enable
corepack prepare pnpm@10.30.3 --activate
pnpm --version
```

若 Node 安装中没有 Corepack，可自行安装 pnpm 10.30.3。Windows PowerShell 可使用 `pnpm.cmd`，无需修改系统脚本执行策略。

获取你有权访问的这个仓库，并在含 `pnpm-workspace.yaml` 的根目录执行：

```sh
pnpm install --frozen-lockfile
```

正常安装会执行依赖所需的安装脚本，并编译共享工作区。首次安装需要网络；系统、CPU 架构和原生依赖必须兼容当前 Electron。不要复制其他系统的 `node_modules`。

## 2. 启动桌面开发端

```sh
pnpm dev
```

开发端使用固定端口 5173。先停止其他占用该端口的开发进程；不要为避开占用随意换端口，以免读到另一套浏览器来源设置。

首次运行会下载 Live2D SDK 与示例角色资源，文件位于本地缓存或素材目录，不进入 Git。此过程与下载聊天模型权重不同。若下载失败，先按 [常见问题](troubleshooting.md) 检查网络和文件。

## 3. 配置第一段对话

1. 打开 **设置 → 服务商**，选择你自己的服务渠道，填写接口地址、模型和密钥。不要把密钥写进源码。
2. 在 **机体模块 → 思考** 中选择该服务商与模型，保存设置。
3. 打开快捷聊天或正式聊天窗口，发送一条简短消息。
4. 需要语音时，再单独配置语音/听觉模块；先让纯文字对话可用，方便判断错误来源。

使用本地 Ollama、LM Studio 或其他兼容服务时，需要先安装并启动对应服务和模型。以服务商实际给出的 OpenAI 兼容 Base URL 为准，别重复附加 `/v1` 或具体请求路径。文本模型不能自动获得视觉能力。

默认官方服务地址为本机回环地址，没有内置官方账号服务。无需为了自配聊天去登录一个不存在的本机云服务。需要官方协议联调时，参见 [配置与费用](configuration.md)。

## 4. 检查开发环境

```sh
pnpm check:dev
pnpm -F @proj-airi/stage-tamagotchi typecheck
```

检查命令用于定位版本、工作区和依赖问题，不调用模型或产生官方消费。更多编译和测试命令见 [开发指南](development.md)。
