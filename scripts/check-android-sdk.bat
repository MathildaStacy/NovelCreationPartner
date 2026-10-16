@echo off
REM Android SDK Components Checker and Installer
REM Checks required SDK components and helps install missing ones

echo ========================================
echo  Android SDK Components Check
echo ========================================
echo.

REM Set Android SDK path
set ANDROID_HOME=%USERPROFILE%\AppData\Local\Android\Sdk

if not exist "%ANDROID_HOME%" (
    echo [ERROR] Android SDK not found!
    echo Please install Android Studio from:
    echo https://developer.android.com/studio
    echo.
    pause
    exit /b 1
)

echo Android SDK Location: %ANDROID_HOME%
echo.
echo ========================================
echo  Required Components (React Native 0.87)
echo ========================================
echo.

REM Check Build Tools
echo [1/6] Checking Build Tools...
set "BUILD_TOOLS_REQUIRED=35.0.0"
if exist "%ANDROID_HOME%\build-tools\%BUILD_TOOLS_REQUIRED%" (
    echo   [OK] Build Tools %BUILD_TOOLS_REQUIRED% installed
) else (
    echo   [MISSING] Build Tools %BUILD_TOOLS_REQUIRED%
    set MISSING_COMPONENTS=1
)

REM Check Platform (Android 14)
echo.
echo [2/6] Checking Android Platform...
set "PLATFORM_REQUIRED=android-34"
if exist "%ANDROID_HOME%\platforms\%PLATFORM_REQUIRED%" (
    echo   [OK] Platform %PLATFORM_REQUIRED% installed
) else (
    echo   [MISSING] Platform %PLATFORM_REQUIRED% (Android 14)
    set MISSING_COMPONENTS=1
)

REM Check Platform Tools
echo.
echo [3/6] Checking Platform Tools...
if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
    echo   [OK] Platform Tools installed
    "%ANDROID_HOME%\platform-tools\adb.exe" version 2>nul | findstr "Version"
) else (
    echo   [MISSING] Platform Tools
    set MISSING_COMPONENTS=1
)

REM Check Emulator
echo.
echo [4/6] Checking Emulator...
if exist "%ANDROID_HOME%\emulator\emulator.exe" (
    echo   [OK] Android Emulator installed
) else (
    echo   [WARNING] Android Emulator not found
    echo   You can install it via Android Studio
)

REM Check NDK
echo.
echo [5/6] Checking NDK...
set "NDK_REQUIRED=27.1.12297006"
if exist "%ANDROID_HOME%\ndk\%NDK_REQUIRED%" (
    echo   [OK] NDK %NDK_REQUIRED% installed
) else (
    echo   [MISSING] NDK %NDK_REQUIRED%
    echo   (Required for React Native native modules)
    set MISSING_COMPONENTS=1
)

REM Check CMake
echo.
echo [6/6] Checking CMake...
if exist "%ANDROID_HOME%\cmake" (
    echo   [OK] CMake installed
) else (
    echo   [WARNING] CMake not found
    echo   (May be needed for some native modules)
)

echo.
echo ========================================
echo  Available AVDs (Virtual Devices)
echo ========================================
echo.

if exist "%ANDROID_HOME%\emulator\emulator.exe" (
    "%ANDROID_HOME%\emulator\emulator.exe" -list-avds 2>nul
    if errorlevel 1 (
        echo No AVDs found. You can create one in Android Studio.
    )
) else (
    echo Emulator not installed.
)

echo.
echo ========================================
echo  Summary
echo ========================================
echo.

if defined MISSING_COMPONENTS (
    echo [ACTION REQUIRED] Some components are missing!
    echo.
    echo Installation Options:
    echo.
    echo Option 1: Using Android Studio (Recommended)
    echo   1. Open Android Studio
    echo   2. Go to: Tools ^> SDK Manager
    echo   3. Install missing components:
    echo      - Android 14.0 (API 34^)
    echo      - Build Tools 35.0.0
    echo      - NDK (Side by side^) 27.1.12297006
    echo      - CMake
    echo.
    echo Option 2: Using sdkmanager (Command Line^)
    echo   Run in new terminal:
    echo   sdkmanager "platform-tools" "platforms;android-34" "build-tools;35.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
    echo.
) else (
    echo [OK] All required components are installed!
    echo.
    echo You can now run: npm run android
    echo.
)

echo ========================================
echo.
pause
