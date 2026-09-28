# 本地部署与构建

本仓库提供桌面客户端源码和必需的共享包。下面的步骤适合在自己的电脑上运行开发端，或编译一份用于本机验证的桌面程序。官方账号、计费、管理端和生产 API 服务端不在此仓库中；仅靠本仓库不能部署完整的官方云服务。

## 1. 准备电脑

- Windows 10/11 x64；其他系统可以开发，但请使用对应平台的 Electron 工具链。
- Node.js 22 LTS，最低 22.12；pnpm 10.30.3。
- 建议 16 GB 内存；8 GB 机器可运行开发端，但完整编译可能需要关闭其他应用或使用交换空间。首次安装与编译还需要足够磁盘空间，并会下载依赖、Electron、Live2D SDK 和示例角色资源。
- 已有需要使用的模型服务，例如本机 Ollama、LM Studio，或自己有权使用的云端接口。

在终端检查版本：

```powershell
node --version
corepack enable
corepack prepare pnpm@10.30.3 --activate
pnpm.cmd --version
```

## 2. 获取并安装源码

使用你有权访问的仓库地址克隆。以下命令都在含 `pnpm-workspace.yaml` 的仓库根目录执行：

```powershell
$repoUrl = '将这里替换为你有权限访问的仓库克隆地址'
git clone $repoUrl WuWiii
cd WuWiii
pnpm.cmd install --frozen-lockfile
pnpm.cmd check:dev
```

依赖由 `pnpm-lock.yaml` 固定；不要从别的系统复制 `node_modules`。Windows PowerShell 如拦截 `pnpm.ps1`，使用示例中的 `pnpm.cmd`，无需修改系统执行策略。

## 3. 选择本地服务地址

默认 API 地址是 `http://127.0.0.1:3000`，只是开发占位地址。只使用自配或本地模型时，无需为此启动官方服务端。需要连接自己有权使用的兼容测试服务时，复制模板并编辑本机文件：

```powershell
Copy-Item apps/stage-tamagotchi/.env.example apps/stage-tamagotchi/.env.local
```

在 `.env.local` 中填写你自己的测试服务地址，然后重启开发端。`VITE_` 变量可能进入客户端构建结果，**不要填 API Key、数据库密码或其他秘密**。模型服务的密钥在应用内的服务商设置中配置。本机 `.env.local` 不要提交到仓库。

## 4. 运行开发端

```powershell
pnpm.cmd dev
```

桌面开发端使用固定的 5173 端口。首次启动可能需要等待资源下载。进入 **设置 → 服务商**，添加自己的模型接口；再到 **机体模块 → 思考** 选择该模型。纯文字对话可用后，再分别配置语音、听觉、视觉和联网搜索。开发版的数据目录与正式安装版隔离。

## 5. 编译并本机预览

```powershell
pnpm.cmd build:source
pnpm.cmd -F @proj-airi/stage-tamagotchi start
```

`build:source` 会先编译共享包，再检查类型并生成 Electron 主进程、预加载和界面文件，输出在 `apps/stage-tamagotchi/out`。第二条命令预览刚编译的程序。它们不会生成官方安装包，也不会部署到服务器。

若只需检查开发环境，可先运行 `pnpm.cmd check:dev` 和 `pnpm.cmd -F @proj-airi/stage-tamagotchi typecheck`。内存不足时关闭占用内存的程序；完整编译比日常启动更吃内存。

## 6. 本机打包（可选）

在 Windows 上，可尝试生成一份仅用于本机验证的解包目录：

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=6144'
pnpm.cmd -F @proj-airi/stage-tamagotchi build:unpack
```

输出位于 `apps/stage-tamagotchi/dist/win-unpacked`，可从其中运行桌面程序。此命令依赖本机 Electron Builder 工具链，首次执行可能下载额外组件。它不包含官方发布所需的受控签名、更新元数据和服务端部署流程；不要把本机产物标为官方安装包。

## 常见阻塞

| 现象 | 先检查 |
| --- | --- |
| 依赖安装或首次资源下载失败 | 网络、代理、磁盘空间，以及 `pnpm-lock.yaml` 是否保持原样 |
| 5173 端口被占用 | 结束旧开发进程后重新运行 `pnpm.cmd dev` |
| 能启动却无法登录官方账号 | 本仓库没有官方服务端；自配模型不依赖官方登录 |
| 本地模型没有回复 | 模型服务是否运行、应用里的接口地址和模型名是否正确 |
| 编译内存不足 | 关闭其他高内存应用，并按 [开发指南](development.md) 的命令逐项检查 |

更多设置见 [快速开始](getting-started.md)、[配置与费用](configuration.md) 和 [常见问题](troubleshooting.md)。
