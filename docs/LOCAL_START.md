# 🚀 本地启动指南

本文档提供NovelCreationPartner的快速启动步骤。

---

## 方法一：使用启动脚本（推荐）

### Windows用户

双击根目录的 `start-dev.bat` 或在终端运行：

```bash
start-dev.bat
```

脚本会自动：
- ✅ 检查Node.js版本
- ✅ 检查并安装依赖
- ✅ 提供启动选项菜单

### macOS/Linux用户

```bash
chmod +x scripts/start-dev.sh
./scripts/start-dev.sh
```

---

## 方法二：手动启动

### 1. 切换Node.js版本

```bash
nvm use 24.22.0
```

如果没有安装该版本：
```bash
nvm install 24.22.0
nvm use 24.22.0
```

### 2. 安装依赖（如果还没安装）

```bash
npm install
```

### 3. 启动Metro服务器

在**第一个终端**运行：

```bash
npm start
```

保持该终端打开，你会看到：
```
 ████████╗  ████████╗ ██╗   ██╗  ██████╗  ██████╗
 ██╔═════╝  ╚══██╔══╝ ██║   ██║ ██╔═══██╗ ██╔══██╗
 ██║  ███╗     ██║    ██║   ██║ ██║   ██║ ██████╔╝
 ██║   ██║     ██║    ██║   ██║ ██║   ██║ ██╔══██╗
 ╚██████╔╝  ████████╗ ╚██████╔╝ ╚██████╔╝ ██║  ██║
  ╚═════╝   ╚═══════╝  ╚═════╝   ╚═════╝  ╚═╝  ╚═╝

› Metro waiting on exp://192.168.x.x:8081
```

### 4. 运行应用

打开**第二个终端**，运行：

#### Android

```bash
npm run android
```

**前提条件**：
- Android Studio已安装
- ANDROID_HOME环境变量已配置
- 模拟器已启动或设备已连接

#### iOS（仅macOS）

```bash
npm run ios
```

---

## 开发环境检查

运行环境诊断工具：

```bash
npm run doctor
```

该命令会检查：
- ✅ Node.js版本
- ✅ 依赖安装状态
- ✅ JDK配置
- ✅ Android SDK
- ✅ iOS开发环境（macOS）

---

## 常用开发命令

### 启动相关

```bash
npm start              # 启动Metro服务器
npm run android        # 运行Android应用
npm run ios            # 运行iOS应用（仅macOS）
```

### 代码质量

```bash
npm run lint           # ESLint检查
npm run typecheck      # TypeScript类型检查
npm run format         # 代码格式化
npm run check          # 运行所有检查（lint + typecheck）
```

### 清理与维护

```bash
npm run clean          # 清理缓存（Metro、Gradle、Pods等）
npm run doctor         # 环境诊断
```

---

## Android环境配置

### Windows

1. **安装Android Studio**：
   - 下载：https://developer.android.com/studio
   - 安装时选择"Android SDK"、"Android SDK Platform"和"Android Virtual Device"

2. **配置环境变量**：

打开"系统属性" → "环境变量"，添加：

```
ANDROID_HOME = C:\Users\你的用户名\AppData\Local\Android\Sdk
```

添加到Path：
```
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
%ANDROID_HOME%\tools
%ANDROID_HOME%\tools\bin
```

3. **重启终端**使环境变量生效

4. **验证安装**：
```bash
adb version
```

### macOS/Linux

添加到 `~/.zshrc` 或 `~/.bashrc`：

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS
# export ANDROID_HOME=$HOME/Android/Sdk      # Linux

export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

重新加载配置：
```bash
source ~/.zshrc  # 或 source ~/.bashrc
```

---

## 启动Android模拟器

### 方法一：Android Studio

1. 打开Android Studio
2. 点击"Device Manager"
3. 选择一个AVD并点击"启动"按钮

### 方法二：命令行

```bash
# 列出所有AVD
emulator -list-avds

# 启动指定AVD
emulator -avd Pixel_5_API_37 &
```

---

## 连接真机设备

### Android

1. **启用开发者选项**：
   - 设置 → 关于手机 → 连续点击"版本号"7次

2. **启用USB调试**：
   - 设置 → 开发者选项 → USB调试

3. **连接设备**：
   - 用USB线连接电脑
   - 手机上授权调试

4. **验证连接**：
```bash
adb devices
```

应该看到你的设备：
```
List of devices attached
emulator-5554    device
```

### iOS

需要macOS + Xcode：
1. 连接设备
2. 信任该电脑
3. 在Xcode中选择设备运行

---

## 开发模式快捷键

### 重新加载应用

- **Android**：双击 `R` 或 `Ctrl+M` 打开菜单选择"Reload"
- **iOS**：`Cmd+R`

### 打开开发者菜单

- **Android**：`Ctrl+M`（或摇晃设备）
- **iOS**：`Cmd+D`（或摇晃设备）

### 开发者菜单功能

- **Enable Fast Refresh**：保存时自动刷新
- **Debug**：打开Chrome DevTools
- **Show Inspector**：元素检查器
- **Show Perf Monitor**：性能监控

---

## 常见问题

### Q1: Metro端口被占用

**现象**：
```
Error: listen EADDRINUSE: address already in use :::8081
```

**解决方案**：
```bash
# Windows
netstat -ano | findstr :8081
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:8081 | xargs kill -9
```

或者使用清理命令：
```bash
npm run clean
```

### Q2: Android模拟器无法连接

**解决方案**：
```bash
adb kill-server
adb start-server
adb devices
```

### Q3: 依赖安装失败

**解决方案**：
```bash
# 清理npm缓存
npm cache clean --force

# 删除node_modules和lock文件
rm -rf node_modules package-lock.json

# 重新安装
npm install
```

### Q4: 代码修改后没有生效

**解决方案**：
1. 启用Fast Refresh：开发者菜单 → Enable Fast Refresh
2. 手动重新加载：双击 `R`（Android）或 `Cmd+R`（iOS）
3. 清理缓存：
```bash
npm run clean
npm start -- --reset-cache
```

### Q5: TypeScript报错但代码正常

**解决方案**：
```bash
# 重启TypeScript服务器（VSCode）
Ctrl+Shift+P → "TypeScript: Restart TS Server"

# 或运行类型检查
npm run typecheck
```

---

## 性能优化建议

### 1. 启用Fast Refresh

Fast Refresh比完全重载快得多，开发时应始终启用。

### 2. 使用Metro缓存

首次启动后，Metro会缓存打包结果，后续启动更快。不要频繁运行 `--reset-cache`。

### 3. 使用真机调试

真机性能远高于模拟器，调试体验更好。

### 4. 关闭不必要的Chrome标签

Chrome DevTools会消耗大量内存，调试完成后及时关闭。

---

## 下一步

应用成功启动后，查看：

- [开发进度文档](./DEVELOPMENT_PROGRESS.md) - 了解当前开发状态
- [项目看板](./KANBAN.md) - 查看任务列表
- [快速上手指南](./QUICK_START.md) - 完整开发指南
- [开发日志](./DEV_LOG.md) - 开发历程记录

---

## 需要帮助？

- **查看文档**：[docs/INDEX.md](./INDEX.md)
- **提交Issue**：[GitHub Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues)
- **联系团队**：见项目README

---

**祝开发愉快！** 🎉
