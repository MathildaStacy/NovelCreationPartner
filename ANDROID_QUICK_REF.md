# 🚀 Android环境配置 - 快速参考

## 当前环境状态

✅ **已确认安装**:
- Android SDK: `C:\Users\FYL\AppData\Local\Android\Sdk`
- JDK 17: `C:\Program Files\Java\jdk-17`
- Build Tools: 34.0.0, 35.0.0
- Platform: android-34 (API 34)
- Platform Tools: ADB 35.0.2

⚠️ **需要配置**:
- 环境变量（当前Git Bash无法识别adb）
- SDK组件：Build Tools 37.0.0, Platform android-37, NDK 27.1.12297006
- AVD虚拟设备（当前无可用模拟器）

---

## ⚡ 最快配置路径（推荐）

### 1️⃣ 永久配置环境变量（2分钟）

**右键PowerShell → 以管理员身份运行**：

```powershell
cd D:\WorkSpace\NovelCreationPartner
.\scripts\set-permanent-env.ps1
```

✅ 完成后 **关闭所有终端和IDE，然后重新打开**。

### 2️⃣ 安装缺失的SDK组件（5-10分钟）

**打开Android Studio** → **Tools** → **SDK Manager**：

**SDK Platforms**:
- ☑ Show Package Details
- ☑ Android 15.0 (API 37)

**SDK Tools**:
- ☑ Show Package Details
- ☑ Android SDK Build-Tools 37.0.0
- ☑ NDK (Side by side) → 27.1.12297006
- ☑ CMake

点击 **Apply** 等待安装。

### 3️⃣ 创建虚拟设备（3分钟）

**Android Studio** → **Tools** → **Device Manager**:

1. **Create Device**
2. 选择 **Pixel 5**
3. 系统镜像: **Android 15.0 (API 37) x86_64**
4. AVD名称: `Pixel_5_API_37`
5. **Finish**

### 4️⃣ 验证环境（1分钟）

打开**新终端**：

```bash
# 检查环境变量
echo $ANDROID_HOME
adb version

# 检查SDK组件
cd D:\WorkSpace\NovelCreationPartner
scripts\check-android-sdk.bat
```

### 5️⃣ 启动应用（2分钟）

**终端1**:
```bash
npm start
```

**终端2**（等Metro启动后）:
```bash
npm run android
```

---

## 📚 详细文档

- [完整配置指南](./docs/ANDROID_SETUP.md) - 所有配置细节
- [配置检查清单](./docs/ANDROID_CONFIG_CHECKLIST.md) - 分步验证
- [本地启动指南](./docs/LOCAL_START.md) - 启动步骤

---

## 🚨 最常见问题

### 问题：环境变量不生效

**症状**: `adb version` 显示 `command not found`

**解决**:
1. 确认已运行 `set-permanent-env.ps1`
2. **关闭所有终端和IDE**
3. 重新打开
4. 如仍不生效，**注销并重新登录Windows**

### 问题：模拟器无法启动

**错误**: `ERROR: x86_64 emulation currently requires hardware acceleration!`

**解决**:
- BIOS启用 **Intel VT-x** 或 **AMD-V**
- Windows功能启用 **Hyper-V**
- 重启电脑

### 问题：Gradle构建失败

**错误**: `SDK location not found`

**解决**:
```bash
echo "sdk.dir=C:\\Users\\FYL\\AppData\\Local\\Android\\Sdk" > android/local.properties
```

---

## ⏱️ 预计总耗时

- 环境变量配置: **2分钟**
- SDK组件下载: **5-10分钟**（取决于网速）
- 创建AVD: **3分钟** + 系统镜像下载（首次约800MB）
- 验证和测试: **3分钟**

**总计**: 约 **15-20分钟**（不含下载时间）

---

**准备好了吗？开始第一步：运行 `.\scripts\set-permanent-env.ps1`** 🚀
