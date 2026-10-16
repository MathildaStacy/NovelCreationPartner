#!/bin/bash

# NovelCreationPartner开发启动脚本

set -e

echo "🚀 NovelCreationPartner 开发环境启动..."
echo ""

# 检查Node.js版本
REQUIRED_NODE="24.22.0"
CURRENT_NODE=$(node -v | sed 's/v//')

if [ "$CURRENT_NODE" != "$REQUIRED_NODE" ]; then
    echo "⚠️  Node.js版本不匹配"
    echo "   当前版本: $CURRENT_NODE"
    echo "   需要版本: $REQUIRED_NODE"
    echo ""
    echo "   请运行: nvm use $REQUIRED_NODE"
    echo ""
    read -p "是否自动切换Node版本？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        nvm use $REQUIRED_NODE
    else
        exit 1
    fi
fi

echo "✅ Node.js版本正确: $REQUIRED_NODE"
echo ""

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
    echo "✅ 依赖安装完成"
else
    echo "✅ 依赖已安装"
fi
echo ""

# 检查Android环境（可选）
if [ -z "$ANDROID_HOME" ]; then
    echo "⚠️  ANDROID_HOME 未设置"
    echo "   Android开发需要配置Android SDK"
    echo "   详见: docs/QUICK_START.md#android环境配置"
    echo ""
    echo "   你仍然可以启动Metro服务器"
    echo ""
fi

# 询问启动方式
echo "请选择启动方式:"
echo "  1) 仅启动Metro服务器（推荐先启动）"
echo "  2) 启动Metro + Android应用"
echo "  3) 运行Android应用（需要Metro已启动）"
echo "  4) 取消"
echo ""
read -p "请输入选项 (1-4): " -n 1 -r
echo ""

case $REPLY in
    1)
        echo "🎯 启动Metro服务器..."
        npm start
        ;;
    2)
        echo "🎯 启动Metro服务器 + Android应用..."
        echo "   Metro将在另一个终端启动..."
        # 在Windows Git Bash中，使用start启动新窗口
        start bash -c "cd '$(pwd)' && npm start"
        echo "   等待Metro启动..."
        sleep 5
        echo "   启动Android应用..."
        npm run android
        ;;
    3)
        echo "🎯 运行Android应用..."
        npm run android
        ;;
    4)
        echo "取消启动"
        exit 0
        ;;
    *)
        echo "无效选项"
        exit 1
        ;;
esac
