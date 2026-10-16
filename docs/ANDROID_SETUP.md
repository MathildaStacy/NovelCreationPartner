# 🤖 Android开发环境配置指南

完整的Android开发环境配置步骤，适用于NovelCreationPartner项目。

---

## 📋 目录

1. [环境要求](#环境要求)
2. [快速配置](#快速配置)
3. [详细步骤](#详细步骤)
4. [验证安装](#验证安装)
5. [创建模拟器](#创建模拟器)
6. [常见问题](#常见问题)

---

## 环境要求

### ✅ 当前已安装

根据检测，你的环境已有：

- ✅ **Android SDK**: `C:\Users\FYL\AppData\Local\Android\Sdk`
- ✅ **JDK 17**: `C:\Program Files\Java\jdk-17`
- ✅ **Build Tools**: 34.0.0, 35.0.0
- ✅ **Platform**: Android 14 (API 34)
- ✅ **Platform Tools**: ADB等工具
- ✅ **Emulator**: Android模拟器

### ⚠️ 需要配置

- ⚠️ **环境变量**: ANDROID_HOME未设置
- ⚠️ **NDK**: 需要安装 v27.1.12297006（项目要求）
- ⚠️ **PATH**: Android工具未加入系统路径

### 📦 项目要求

根据 `android/build.gradle`：

```gradle
buildToolsVersion = "37.0.0"      # 需要升级到37
minSdkVersion = 24
compileSdkVersion = 37             # 需要安装API 37
targetSdkVersion = 36
ndkVersion = "27.1.12297006"       # 需要安装
```

---

## 快速配置

### 方法一：自动配置（推荐）

#### 步骤1: 配置环境变量（临时）

双击运行：
```
scripts\setup-android-env.bat
```

这会为当前会话设置环境变量。

#### 步骤2: 永久配置环境变量

**以管理员身份**运行PowerShell，然后执行：

```powershell
cd D:\WorkSpace\NovelCreationPartner
.\scripts\set-permanent-env.ps1
```

#### 步骤3: 检查SDK组件

```bash
scripts\check-android-sdk.bat
```

这会检测缺失的SDK组件。

#### 步骤4: 安装缺失组件

打开Android Studio:
1. **Tools** → **SDK Manager**
2. 在 **SDK Platforms** 标签页:
   - ✅ Android 14.0 (API 34) - 已安装
   - ☐ Android 15.0 (API 37) - **需要安装**

3. 在 **SDK Tools** 标签页:
   - ✅ Android SDK Build-Tools 35.0.0 - 已安装
   - ☐ Android SDK Build-Tools 37.0.0 - **需要安装**
   - ☐ NDK (Side by side) 27.1.12297006 - **需要安装**
   - ✅ Android SDK Platform-Tools - 已安装
   - ✅ Android Emulator - 已安装
   - ☐ CMake 3.22.1 - 推荐安装

4. 点击 **Apply** 下载安装

---

## 详细步骤

### 第一步：安装Android Studio

如果还没有安装Android Studio：

1. **下载**: https://developer.android.com/studio
2. **安装**时选择：
   - Android SDK
   - Android SDK Platform
   - Android Virtual Device (AVD)
3. **启动**Android Studio，完成初始设置向导

### 第二步：配置环境变量

#### 选项A：使用PowerShell脚本（推荐）

1. **右键**点击PowerShell图标 → **以管理员身份运行**

2. 如果PowerShell执行策略限制，先运行：
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

3. 运行配置脚本：
```powershell
cd D:\WorkSpace\NovelCreationPartner
.\scripts\set-permanent-env.ps1
```

4. **重启所有终端和IDE**使环境变量生效

#### 选项B：手动配置

1. **打开系统属性**：
   - Win + R → 输入 `sysdm.cpl` → 回车
   - 或：右键"此电脑" → 属性 → 高级系统设置

2. **点击"环境变量"按钮**

3. **在"用户变量"区域，点击"新建"**：

   **变量1**:
   - 变量名: `ANDROID_HOME`
   - 变量值: `C:\Users\FYL\AppData\Local\Android\Sdk`

   **变量2**:
   - 变量名: `ANDROID_SDK_ROOT`
   - 变量值: `C:\Users\FYL\AppData\Local\Android\Sdk`

   **变量3**:
   - 变量名: `JAVA_HOME`
   - 变量值: `C:\Program Files\Java\jdk-17`

4. **编辑Path变量**：
   - 选中"Path" → 点击"编辑"
   - 点击"新建"，添加以下路径：
     ```
     %ANDROID_HOME%\platform-tools
     %ANDROID_HOME%\emulator
     %ANDROID_HOME%\tools
     %ANDROID_HOME%\tools\bin
     ```

5. **点击"确定"保存所有更改**

6. **重启所有终端和IDE**

### 第三步：安装SDK组件

#### 使用Android Studio GUI

1. 打开**Android Studio**

2. **Configure** → **SDK Manager**（或 **Tools** → **SDK Manager**）

3. **SDK Platforms**标签页：
   - ✅ 勾选 **Android 14.0 (API 34)** - 已有
   - ✅ 勾选 **Android 15.0 (API 37)** - 需要安装
   - ✅ 勾选 **Show Package Details**查看详情

4. **SDK Tools**标签页：
   - ✅ 勾选 **Android SDK Build-Tools 37.0.0**
   - ✅ 勾选 **Android SDK Build-Tools 35.0.0** - 已有
   - ✅ 勾选 **NDK (Side by side)**
     - 展开，选择具体版本 **27.1.12297006**
   - ✅ 勾选 **CMake** (选择3.22.1或更高版本)
   - ✅ 勾选 **Android SDK Platform-Tools** - 已有
   - ✅ 勾选 **Android Emulator** - 已有

5. 点击 **Apply** → **OK** 开始下载安装

#### 使用命令行 sdkmanager

如果有`cmdline-tools`，也可以用命令行：

```bash
# 首先，需要安装cmdline-tools
# 在Android Studio SDK Manager中安装"Android SDK Command-line Tools"

# 然后运行：
sdkmanager "platforms;android-37" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```

### 第四步：验证安装

运行验证脚本：

```bash
scripts\check-android-sdk.bat
```

或手动验证：

```bash
# 检查环境变量
echo %ANDROID_HOME%
echo %JAVA_HOME%

# 检查ADB
adb version

# 检查Java
java -version

# 检查模拟器
emulator -list-avds
```

**预期输出**：

```bash
> echo %ANDROID_HOME%
C:\Users\FYL\AppData\Local\Android\Sdk

> adb version
Android Debug Bridge version 1.0.41

> java -version
java version "17.0.12" 2024-07-16 LTS
```

---

## 创建模拟器

### 使用Android Studio创建AVD

1. 打开**Android Studio**

2. **Tools** → **Device Manager**（或右上角设备图标）

3. 点击 **Create Device**

4. **选择设备类型**：
   - 推荐: **Pixel 5** 或 **Pixel 6**
   - 点击 **Next**

5. **选择系统镜像**：
   - 推荐: **Android 14.0 (API 34)** 或 **Android 15.0 (API 37)**
   - 选择 **x86_64** 架构（性能更好）
   - 点击 **Download** 下载镜像（如果还没下载）
   - 点击 **Next**

6. **配置AVD**：
   - AVD Name: `Pixel_5_API_34` 或自定义
   - Startup orientation: Portrait
   - 调整内存设置（建议RAM 2048MB+）
   - 点击 **Finish**

### 启动模拟器

#### 方法1：通过Android Studio

1. **Device Manager** → 选择你的AVD
2. 点击 ▶️ **启动**按钮

#### 方法2：通过命令行

```bash
# 列出所有AVD
emulator -list-avds

# 启动指定AVD（后台运行）
emulator -avd Pixel_5_API_34 &

# 或者不加&在前台运行（可以看到日志）
emulator -avd Pixel_5_API_34
```

#### 验证模拟器连接

```bash
adb devices
```

应该看到：
```
List of devices attached
emulator-5554    device
```

---

## 验证安装

### 完整环境检查

运行项目提供的环境诊断工具：

```bash
npm run doctor
```

### 运行测试应用

1. **启动Metro**（第一个终端）：
```bash
npm start
```

2. **启动模拟器**（Android Studio或命令行）

3. **运行应用**（第二个终端）：
```bash
npm run android
```

如果一切正常，应用会自动安装到模拟器并启动。

---

## 常见问题

### Q1: 环境变量设置后不生效

**问题**：
```bash
> echo %ANDROID_HOME%
%ANDROID_HOME%  # 显示原样，说明未设置
```

**解决方案**：
1. 确认已在"用户变量"或"系统变量"中设置
2. **完全关闭所有终端和IDE**
3. 重新打开终端验证
4. 如果仍不生效，**注销并重新登录Windows**

### Q2: ADB无法识别

**问题**：
```bash
> adb version
'adb' is not recognized as an internal or external command
```

**解决方案**：
```bash
# 临时方案：手动设置PATH
set PATH=%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools;%PATH%

# 永久方案：运行环境配置脚本
.\scripts\set-permanent-env.ps1

# 然后重启终端
```

### Q3: Gradle构建失败 - SDK版本不匹配

**问题**：
```
> Failed to find Build Tools revision 37.0.0
> Failed to find target with hash string 'android-37'
```

**解决方案**：
1. 打开Android Studio SDK Manager
2. 安装 **Android 15.0 (API 37)**
3. 安装 **Build Tools 37.0.0**
4. 清理并重新构建：
```bash
cd android
./gradlew clean
cd ..
npm run android
```

### Q4: NDK未找到

**问题**：
```
NDK is not installed
```

**解决方案**：
1. Android Studio → **SDK Manager** → **SDK Tools**
2. 勾选 **NDK (Side by side)**
3. 展开并选择版本 **27.1.12297006**
4. 点击Apply安装

或者修改 `android/build.gradle`，注释掉NDK版本：
```gradle
// ndkVersion = "27.1.12297006"
```

### Q5: 模拟器启动失败

**问题**：
```
emulator: ERROR: x86_64 emulation currently requires hardware acceleration!
```

**解决方案**：

**Windows需要启用虚拟化**：

1. **检查BIOS中是否启用Intel VT-x或AMD-V**：
   - 重启电脑进入BIOS
   - 找到Virtualization Technology
   - 设置为Enabled

2. **启用Hyper-V**（Windows 10/11专业版）：
```powershell
# 以管理员身份运行PowerShell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

3. **或安装HAXM**（Intel处理器，Windows家庭版）：
   - 下载：https://github.com/intel/haxm/releases
   - 安装HAXM
   - 重启电脑

### Q6: 端口冲突

**问题**：
```
Error: Unable to launch emulator. Port 5554 is already in use.
```

**解决方案**：
```bash
# 查看占用端口的进程
netstat -ano | findstr :5554

# 终止进程（替换<PID>）
taskkill /PID <PID> /F

# 或者杀死所有ADB进程
adb kill-server
adb start-server
```

### Q7: 真机连接不上

**问题**：
设备连接USB后，`adb devices`显示空或unauthorized。

**解决方案**：

1. **启用开发者模式**（Android手机）：
   - 设置 → 关于手机
   - 连续点击"版本号"7次

2. **启用USB调试**：
   - 设置 → 开发者选项
   - 打开"USB调试"

3. **连接电脑**：
   - 用USB线连接
   - 手机上会弹出授权提示，点击"允许"

4. **验证连接**：
```bash
adb devices
```

应该看到：
```
List of devices attached
1234567890ABCDEF    device
```

### Q8: Gradle下载慢

**问题**：
构建时Gradle依赖下载非常慢或失败。

**解决方案**：

配置Gradle使用国内镜像，编辑 `android/build.gradle`：

```gradle
allprojects {
    repositories {
        // 使用阿里云镜像
        maven { url 'https://maven.aliyun.com/repository/public/' }
        maven { url 'https://maven.aliyun.com/repository/google/' }
        maven { url 'https://maven.aliyun.com/repository/jcenter/' }
        
        google()
        mavenCentral()
    }
}
```

---

## 配置脚本说明

项目提供了三个配置脚本：

### 1. `scripts\setup-android-env.bat`

**用途**：为当前会话设置环境变量（临时）

**使用**：
```bash
scripts\setup-android-env.bat
```

**特点**：
- ✅ 无需管理员权限
- ❌ 关闭终端后失效
- ✅ 适合快速测试

### 2. `scripts\set-permanent-env.ps1`

**用途**：永久设置用户环境变量

**使用**：
```powershell
# 以管理员身份运行
.\scripts\set-permanent-env.ps1
```

**特点**：
- ✅ 永久生效
- ✅ 需要管理员权限
- ✅ 自动检查SDK存在性
- ✅ 智能更新PATH

### 3. `scripts\check-android-sdk.bat`

**用途**：检查SDK组件安装状态

**使用**：
```bash
scripts\check-android-sdk.bat
```

**检查项**：
- Build Tools版本
- Android Platform版本
- Platform Tools (ADB)
- Emulator
- NDK
- CMake
- 已创建的AVD列表

---

## 下一步

环境配置完成后：

1. **验证安装**：
```bash
npm run doctor
```

2. **启动开发**：
```bash
# 终端1: 启动Metro
npm start

# 终端2: 运行Android
npm run android
```

3. **查看开发指南**：
   - [本地启动指南](./LOCAL_START.md)
   - [快速上手](./QUICK_START.md)
   - [开发进度](./DEVELOPMENT_PROGRESS.md)

---

## 参考资料

- [React Native环境搭建](https://reactnative.dev/docs/environment-setup)
- [Android Studio用户指南](https://developer.android.com/studio/intro)
- [Android SDK工具](https://developer.android.com/studio/command-line)
- [ADB使用指南](https://developer.android.com/studio/command-line/adb)

---

**环境配置有问题？** 运行 `npm run doctor` 或查看[常见问题](#常见问题)部分。
