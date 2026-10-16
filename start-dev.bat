@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo =====================================================
echo   NovelCreationPartner 开发环境启动
echo =====================================================
echo.

:: 检查Node.js版本
set REQUIRED_NODE=24.22.0
for /f "tokens=*" %%i in ('node -v') do set CURRENT_NODE=%%i
set CURRENT_NODE=%CURRENT_NODE:v=%

if not "%CURRENT_NODE%"=="%REQUIRED_NODE%" (
    echo [警告] Node.js版本不匹配
    echo    当前版本: %CURRENT_NODE%
    echo    需要版本: %REQUIRED_NODE%
    echo.
    echo    请运行: nvm use %REQUIRED_NODE%
    echo.
    set /p "SWITCH=是否自动切换Node版本？(y/n): "
    if /i "!SWITCH!"=="y" (
        call nvm use %REQUIRED_NODE%
        if errorlevel 1 (
            echo [错误] 切换Node版本失败
            echo 请手动运行: nvm install %REQUIRED_NODE% ^&^& nvm use %REQUIRED_NODE%
            pause
            exit /b 1
        )
    ) else (
        exit /b 1
    )
)

echo [✓] Node.js版本正确: %REQUIRED_NODE%
echo.

:: 检查依赖
if not exist "node_modules" (
    echo [→] 安装依赖中...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [✓] 依赖安装完成
) else (
    echo [✓] 依赖已安装
)
echo.

:: 检查Android环境
if "%ANDROID_HOME%"=="" (
    echo [警告] ANDROID_HOME 未设置
    echo    Android开发需要配置Android SDK
    echo    详见: docs\QUICK_START.md
    echo.
    echo    你仍然可以启动Metro服务器
    echo.
)

:: 启动选项
echo.
echo 请选择启动方式:
echo   1. 仅启动Metro服务器 (推荐先启动)
echo   2. 启动Metro + Android应用
echo   3. 运行Android应用 (需要Metro已启动)
echo   4. 运行代码检查
echo   5. 清理缓存并重新启动
echo   0. 取消
echo.

set /p "CHOICE=请输入选项 (0-5): "

if "%CHOICE%"=="1" (
    echo.
    echo [→] 启动Metro服务器...
    echo.
    call npm start
) else if "%CHOICE%"=="2" (
    echo.
    echo [→] 启动Metro服务器 + Android应用...
    echo    Metro将在新窗口启动...
    echo.
    start "Metro Bundler" cmd /k "npm start"
    echo    等待Metro启动...
    timeout /t 8 /nobreak >nul
    echo.
    echo [→] 启动Android应用...
    call npm run android
) else if "%CHOICE%"=="3" (
    echo.
    echo [→] 运行Android应用...
    call npm run android
) else if "%CHOICE%"=="4" (
    echo.
    echo [→] 运行ESLint检查...
    call npm run lint
    echo.
    echo [→] 运行TypeScript检查...
    call npm run typecheck
    echo.
    echo [✓] 代码检查完成
    pause
) else if "%CHOICE%"=="5" (
    echo.
    echo [→] 清理缓存中...
    call npm run clean
    echo.
    echo [→] 重新安装依赖...
    call npm install
    echo.
    echo [✓] 清理完成，请选择启动方式
    goto :START
) else if "%CHOICE%"=="0" (
    echo.
    echo 取消启动
    exit /b 0
) else (
    echo.
    echo [错误] 无效选项
    pause
    exit /b 1
)

:START
endlocal
