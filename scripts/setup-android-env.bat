@echo off
REM Android Environment Setup Script for NovelCreationPartner
REM This script configures Android environment variables for the current session

echo ========================================
echo  Android Environment Configuration
echo ========================================
echo.

REM Set Android SDK path
set ANDROID_HOME=%USERPROFILE%\AppData\Local\Android\Sdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%

REM Set Java Home (already detected)
set JAVA_HOME=C:\Program Files\Java\jdk-17

REM Add Android tools to PATH
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
set PATH=%ANDROID_HOME%\emulator;%PATH%
set PATH=%ANDROID_HOME%\tools;%PATH%
set PATH=%ANDROID_HOME%\tools\bin;%PATH%

echo [1/3] Checking Android SDK...
if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
    echo   [OK] Android SDK found at: %ANDROID_HOME%
) else (
    echo   [ERROR] Android SDK not found!
    echo   Please install Android Studio first.
    pause
    exit /b 1
)

echo.
echo [2/3] Checking Java Development Kit...
if exist "%JAVA_HOME%\bin\java.exe" (
    echo   [OK] JDK found at: %JAVA_HOME%
    java -version 2>&1 | findstr "version"
) else (
    echo   [ERROR] JDK not found!
    pause
    exit /b 1
)

echo.
echo [3/3] Verifying ADB...
adb version 2>nul
if %errorlevel% equ 0 (
    echo   [OK] ADB is working correctly
) else (
    echo   [WARNING] ADB might not be in PATH
)

echo.
echo ========================================
echo  Environment Configuration Summary
echo ========================================
echo ANDROID_HOME    = %ANDROID_HOME%
echo ANDROID_SDK_ROOT= %ANDROID_SDK_ROOT%
echo JAVA_HOME       = %JAVA_HOME%
echo.
echo ========================================
echo  Configuration Complete!
echo ========================================
echo.
echo Current environment variables are set for this session.
echo.
echo To make these permanent:
echo 1. Open "System Properties" ^> "Environment Variables"
echo 2. Add the following User Variables:
echo    - ANDROID_HOME: %ANDROID_HOME%
echo    - JAVA_HOME: %JAVA_HOME%
echo 3. Add to Path:
echo    - %%ANDROID_HOME%%\platform-tools
echo    - %%ANDROID_HOME%%\emulator
echo    - %%ANDROID_HOME%%\tools
echo    - %%ANDROID_HOME%%\tools\bin
echo.
echo Or run: scripts\set-permanent-env.ps1 (requires admin)
echo.
pause
