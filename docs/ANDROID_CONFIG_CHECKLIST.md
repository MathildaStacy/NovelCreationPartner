# 🎯 Android环境配置完成检查清单

## 当前环境状态

### ✅ 已确认可用

- ✅ **Android SDK**: `C:\Users\FYL\AppData\Local\Android\Sdk`
- ✅ **JDK 17**: `C:\Program Files\Java\jdk-17`
- ✅ **Platform Tools**: ADB v1.0.41 (35.0.2)
- ✅ **Build Tools**: 34.0.0, 35.0.0
- ✅ **Android Platform**: android-34 (API 34)
- ✅ **Emulator**: 已安装

### ⚠️ 需要配置

#### 1. 环境变量配置 ⚠️

**状态**: 未配置（Git Bash中无法访问adb命令）

**解决方案**: 

**方法A - 推荐（永久配置）**：
```powershell
# 右键PowerShell → 以管理员身份运行
cd D:\WorkSpace\NovelCreationPartner
.\scripts\set-permanent-env.ps1
# 完成后重启所有终端
```

**方法B - 临时测试**：
```bash
# 在当前Git Bash会话中
export ANDROID_HOME="$USERPROFILE/AppData/Local/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb version  # 测试是否生效
```

#### 2. SDK组件缺失 ⚠️

**项目需求** (来自 `android/build.gradle`):
```gradle
buildToolsVersion = "37.0.0"      ⚠️ 需要安装
compileSdkVersion = 37             ⚠️ 需要安装 (Android 15, API 37)
targetSdkVersion = 36
ndkVersion = "27.1.12297006"       ⚠️ 需要安装
```

**当前已有**:
```
✅ Build Tools: 34.0.0, 35.0.0
✅ Platform: android-34 (API 34)
```

**需要安装**:
```
❌ Build Tools 37.0.0
❌ Platform android-37 (API 37 - Android 15)
❌ NDK 27.1.12297006
```

**解决方案**:

打开 **Android Studio** → **Tools** → **SDK Manager**:

**SDK Platforms 标签页**:
- ☑ Android 15.0 (API 37)

**SDK Tools 标签页**:
- ☑ Android SDK Build-Tools 37.0.0
- ☑ NDK (Side by side) → 展开选择 27.1.12297006
- ☑ CMake (推荐)

点击 **Apply** 安装。

#### 3. 没有可用的AVD（模拟器） ⚠️

**状态**: 未创建任何虚拟设备

**解决方案**:

打开 **Android Studio** → **Tools** → **Device Manager**:

1. 点击 **Create Device**
2. 选择设备: **Pixel 5** 或 **Pixel 6**
3. 选择系统镜像: 
   - **Android 14.0 (API 34)** - x86_64
   - 或 **Android 15.0 (API 37)** - x86_64
4. AVD名称: `Pixel_5_API_34` (推荐)
5. 点击 **Finish**

**或使用真机**:
1. 手机启用开发者选项和USB调试
2. USB连接电脑
3. 运行 `adb devices` 确认连接

---

## 📝 配置步骤（按顺序执行）

### 第一步：永久配置环境变量

**以管理员身份运行PowerShell**:

```powershell
# 1. 打开PowerShell (管理员)
# 2. 切换到项目目录
cd D:\WorkSpace\NovelCreationPartner

# 3. 运行配置脚本
.\scripts\set-permanent-env.ps1

# 4. 等待完成，看到成功提示
```

**预期输出**:
```
========================================
 Configuration Complete!
========================================

Environment variables have been set permanently.

[IMPORTANT] Next steps:
1. Close and reopen all terminal windows
2. Restart your IDE (VS Code, etc.)
```

**关闭所有终端和IDE，然后重新打开**。

### 第二步：验证环境变量

打开**新的**终端（Git Bash或PowerShell）:

```bash
# 检查环境变量
echo $ANDROID_HOME
# 应该输出: C:\Users\FYL\AppData\Local\Android\Sdk

# 检查ADB
adb version
# 应该输出: Android Debug Bridge version 1.0.41

# 检查Java
java -version
# 应该输出: java version "17.0.12"
```

### 第三步：安装缺失的SDK组件

1. 打开 **Android Studio**

2. **Tools** → **SDK Manager**（或欢迎界面的 **More Actions** → **SDK Manager**）

3. **SDK Platforms** 标签页:
   - ✅ 勾选 **Show Package Details** (右下角)
   - ✅ 勾选 **Android 15.0 (API 37)**
     - ✅ Android SDK Platform 37
     - ✅ Sources for Android 37 (可选)

4. **SDK Tools** 标签页:
   - ✅ 勾选 **Show Package Details** (右下角)
   - ✅ 展开 **Android SDK Build-Tools**
     - ✅ 勾选 **37.0.0**
   - ✅ 展开 **NDK (Side by side)**
     - ✅ 勾选 **27.1.12297006**
   - ✅ 勾选 **CMake** (如果未安装)

5. 点击 **Apply** → **OK**

6. 等待下载和安装完成

### 第四步：创建Android虚拟设备（AVD）

1. 打开 **Android Studio**

2. **Tools** → **Device Manager**（或右上角手机图标）

3. 点击 **Create Device** (或 **+** 按钮)

4. **选择硬件**:
   - 类别: Phone
   - 设备: **Pixel 5** 或 **Pixel 6** (推荐)
   - 点击 **Next**

5. **选择系统镜像**:
   - 推荐: **Vanilla Ice Cream | 37 | x86_64 | Android 15.0**
   - 或: **UpsideDownCake | 34 | x86_64 | Android 14.0**
   - 如果未下载，点击 **Download** 旁边的链接
   - 下载完成后选中，点击 **Next**

6. **验证配置**:
   - AVD Name: `Pixel_5_API_37` (或自定义)
   - Startup orientation: Portrait
   - RAM: 2048 MB 或更高
   - VM heap: 512 MB
   - 点击 **Show Advanced Settings** (可选，调整更多配置)
   - 点击 **Finish**

### 第五步：验证完整环境

运行检查脚本:

```bash
cd D:\WorkSpace\NovelCreationPartner
scripts\check-android-sdk.bat
```

**预期输出**:
```
========================================
 Android SDK Components Check
========================================

Android SDK Location: C:\Users\FYL\AppData\Local\Android\Sdk

[1/6] Checking Build Tools...
  [OK] Build Tools 35.0.0 installed

[2/6] Checking Android Platform...
  [OK] Platform android-34 (Android 14) installed

[3/6] Checking Platform Tools...
  [OK] Platform Tools installed

[4/6] Checking Emulator...
  [OK] Android Emulator installed

[5/6] Checking NDK...
  [OK] NDK 27.1.12297006 installed

[6/6] Checking CMake...
  [OK] CMake installed

========================================
 Available AVDs (Virtual Devices)
========================================

Pixel_5_API_37

========================================
 Summary
========================================

[OK] All required components are installed!
```

### 第六步：测试运行应用

#### 启动模拟器

**方法1 - Android Studio**:
- **Device Manager** → 选择你的AVD → 点击 ▶️

**方法2 - 命令行**:
```bash
emulator -avd Pixel_5_API_37 &
```

等待模拟器完全启动（看到主屏幕）。

#### 运行React Native应用

打开**两个终端**:

**终端1 - Metro Bundler**:
```bash
cd D:\WorkSpace\NovelCreationPartner
npm start
```

等待看到 `› Metro waiting on exp://...`

**终端2 - Android应用**:
```bash
cd D:\WorkSpace\NovelCreationPartner
npm run android
```

**预期结果**:
- Gradle开始构建
- 应用安装到模拟器
- 应用自动启动并显示React Native欢迎界面

---

## ✅ 配置完成标志

当你看到以下所有✅时，环境配置完成：

- ✅ `echo $ANDROID_HOME` 输出正确路径
- ✅ `adb version` 正常显示版本
- ✅ `java -version` 显示Java 17
- ✅ `adb devices` 能看到模拟器或设备
- ✅ `npm run android` 成功启动应用

---

## 🚨 常见问题快速解决

### 问题1: 环境变量不生效

```bash
> echo $ANDROID_HOME
# (空输出或显示 %ANDROID_HOME%)
```

**解决**:
1. 确认已运行 `set-permanent-env.ps1`
2. **关闭所有终端和IDE**
3. 重新打开
4. 如果还不行，**注销并重新登录Windows**

### 问题2: 模拟器无法启动

**错误**: `ERROR: x86_64 emulation currently requires hardware acceleration!`

**解决**:
1. BIOS中启用 **Intel VT-x** 或 **AMD-V**
2. Windows启用Hyper-V:
```powershell
# 管理员PowerShell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```
3. 重启电脑

### 问题3: Gradle构建失败

**错误**: `SDK location not found`

**解决**:

创建 `android/local.properties`:
```properties
sdk.dir=C:\\Users\\FYL\\AppData\\Local\\Android\\Sdk
```

或运行:
```bash
echo "sdk.dir=C:\\Users\\FYL\\AppData\\Local\\Android\\Sdk" > android/local.properties
```

### 问题4: Metro端口被占用

**错误**: `Error: listen EADDRINUSE :::8081`

**解决**:
```bash
# 清理缓存并重启
npm run clean
npm start -- --reset-cache
```

---

## 📚 相关文档

- [Android环境详细配置](./ANDROID_SETUP.md) - 完整配置指南
- [本地启动指南](./LOCAL_START.md) - 启动步骤
- [快速上手](./QUICK_START.md) - 开发指南

---

## 🎯 下一步

环境配置完成后：

1. **启动开发服务器**:
```bash
npm start
```

2. **运行Android应用**:
```bash
npm run android
```

3. **开始开发**:
   - 查看 [开发进度](./DEVELOPMENT_PROGRESS.md)
   - 查看 [项目看板](./KANBAN.md)
   - 开始第一个功能开发

---

**祝配置顺利！** 🚀

有问题随时查看 [ANDROID_SETUP.md](./ANDROID_SETUP.md) 的常见问题部分。
