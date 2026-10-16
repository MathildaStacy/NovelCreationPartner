# Android Environment Setup - Permanent Configuration
# Run this script as Administrator to set environment variables permanently

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Android Environment Configuration" -ForegroundColor Cyan
Write-Host " (Permanent System Settings)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[ERROR] This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host "Please right-click and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

# Define paths
$androidHome = "$env:USERPROFILE\AppData\Local\Android\Sdk"
$javaHome = "C:\Program Files\Java\jdk-17"

Write-Host "[1/4] Verifying Android SDK..." -ForegroundColor Yellow
if (Test-Path "$androidHome\platform-tools\adb.exe") {
    Write-Host "  [OK] Android SDK found" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] Android SDK not found at: $androidHome" -ForegroundColor Red
    Write-Host "  Please install Android Studio first." -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host ""
Write-Host "[2/4] Verifying JDK..." -ForegroundColor Yellow
if (Test-Path "$javaHome\bin\java.exe") {
    Write-Host "  [OK] JDK found" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] JDK not found at: $javaHome" -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "[3/4] Setting environment variables..." -ForegroundColor Yellow

try {
    # Set ANDROID_HOME
    [System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidHome, [System.EnvironmentVariableTarget]::User)
    Write-Host "  [OK] ANDROID_HOME = $androidHome" -ForegroundColor Green
    
    # Set ANDROID_SDK_ROOT
    [System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $androidHome, [System.EnvironmentVariableTarget]::User)
    Write-Host "  [OK] ANDROID_SDK_ROOT = $androidHome" -ForegroundColor Green
    
    # Set JAVA_HOME
    [System.Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, [System.EnvironmentVariableTarget]::User)
    Write-Host "  [OK] JAVA_HOME = $javaHome" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Failed to set environment variables: $_" -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "[4/4] Updating PATH..." -ForegroundColor Yellow

try {
    # Get current user PATH
    $currentPath = [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
    
    # Define paths to add
    $pathsToAdd = @(
        "%ANDROID_HOME%\platform-tools",
        "%ANDROID_HOME%\emulator",
        "%ANDROID_HOME%\tools",
        "%ANDROID_HOME%\tools\bin"
    )
    
    # Add each path if not already present
    $pathModified = $false
    foreach ($pathToAdd in $pathsToAdd) {
        if ($currentPath -notlike "*$pathToAdd*") {
            $currentPath = "$currentPath;$pathToAdd"
            $pathModified = $true
            Write-Host "  [+] Added: $pathToAdd" -ForegroundColor Green
        } else {
            Write-Host "  [SKIP] Already in PATH: $pathToAdd" -ForegroundColor Gray
        }
    }
    
    if ($pathModified) {
        [System.Environment]::SetEnvironmentVariable("Path", $currentPath, [System.EnvironmentVariableTarget]::User)
        Write-Host "  [OK] PATH updated successfully" -ForegroundColor Green
    } else {
        Write-Host "  [OK] PATH already configured" -ForegroundColor Green
    }
} catch {
    Write-Host "  [ERROR] Failed to update PATH: $_" -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Configuration Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Environment variables have been set permanently." -ForegroundColor Green
Write-Host ""
Write-Host "[IMPORTANT] Next steps:" -ForegroundColor Yellow
Write-Host "1. Close and reopen all terminal windows" -ForegroundColor White
Write-Host "2. Restart your IDE (VS Code, etc.)" -ForegroundColor White
Write-Host "3. Verify installation:" -ForegroundColor White
Write-Host "   - Open new terminal" -ForegroundColor White
Write-Host "   - Run: adb version" -ForegroundColor White
Write-Host ""
Write-Host "Configuration Summary:" -ForegroundColor Cyan
Write-Host "  ANDROID_HOME    = $androidHome" -ForegroundColor White
Write-Host "  ANDROID_SDK_ROOT= $androidHome" -ForegroundColor White
Write-Host "  JAVA_HOME       = $javaHome" -ForegroundColor White
Write-Host ""
pause
