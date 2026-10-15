#!/bin/bash

# GitHub 仓库快速推送脚本
# 使用方法：./push_to_github.sh

set -e

REPO_DIR="/Users/boren.fang/Desktop/Personal/NovelAgent/NovelCreationPartner"
GITHUB_USER="MathildaStacy"
REPO_NAME="NovelCreationPartner"

cd "$REPO_DIR"

echo "================================================"
echo "  GitHub 仓库推送脚本"
echo "  仓库：$GITHUB_USER/$REPO_NAME"
echo "================================================"
echo ""

# 检查是否有未提交的更改
if [[ -n $(git status -s) ]]; then
    echo "❌ 检测到未提交的更改，请先提交代码："
    echo ""
    git status -s
    echo ""
    echo "提交命令示例："
    echo "  git add ."
    echo "  git commit -m \"your commit message\""
    exit 1
fi

echo "✅ 工作区干净，准备推送..."
echo ""

# 检查远程仓库配置
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")

if [[ -z "$REMOTE_URL" ]]; then
    echo "⚠️  未检测到远程仓库，正在配置..."
    git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
    echo "✅ 远程仓库已配置"
elif [[ "$REMOTE_URL" != *"$GITHUB_USER/$REPO_NAME"* ]]; then
    echo "⚠️  远程仓库 URL 不匹配，正在更新..."
    git remote set-url origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
    echo "✅ 远程仓库 URL 已更新"
fi

echo ""
echo "当前远程仓库："
git remote -v
echo ""

# 检查认证方式
echo "选择认证方式："
echo "1) Personal Access Token (HTTPS)"
echo "2) SSH Key"
echo "3) GitHub CLI"
echo ""
read -p "请选择 (1/2/3): " auth_choice

case $auth_choice in
    1)
        echo ""
        echo "📝 使用 Personal Access Token 认证"
        echo ""
        echo "如果你还没有创建 token，请访问："
        echo "https://github.com/settings/tokens"
        echo ""
        echo "推送时会提示输入用户名和密码："
        echo "  - 用户名：$GITHUB_USER"
        echo "  - 密码：粘贴你的 Personal Access Token"
        echo ""
        read -p "按回车继续推送..."

        git push -u origin main
        ;;
    2)
        echo ""
        echo "🔑 使用 SSH Key 认证"
        echo ""

        # 测试 SSH 连接
        if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
            echo "✅ SSH 连接测试成功"
        else
            echo "❌ SSH 连接失败，请确认："
            echo "  1. SSH 公钥已添加到 GitHub"
            echo "  2. 私钥已加载：ssh-add ~/.ssh/id_ed25519"
            echo ""
            echo "查看公钥命令："
            echo "  cat ~/.ssh/id_ed25519.pub"
            echo ""
            echo "添加公钥地址："
            echo "  https://github.com/settings/keys"
            exit 1
        fi

        # 切换到 SSH URL
        git remote set-url origin "git@github.com:$GITHUB_USER/$REPO_NAME.git"
        echo "✅ 已切换到 SSH URL"
        echo ""

        git push -u origin main
        ;;
    3)
        echo ""
        echo "🚀 使用 GitHub CLI 认证"
        echo ""

        # 检查 gh 是否安装
        if ! command -v gh &> /dev/null; then
            echo "❌ GitHub CLI 未安装"
            echo ""
            echo "安装命令："
            echo "  macOS: brew install gh"
            echo "  或访问：https://cli.github.com/"
            exit 1
        fi

        # 检查登录状态
        if ! gh auth status &> /dev/null; then
            echo "⚠️  未登录，正在启动认证流程..."
            gh auth login
        else
            echo "✅ 已登录 GitHub CLI"
        fi
        echo ""

        git push -u origin main
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac

echo ""
echo "================================================"
echo "✅ 推送成功！"
echo "================================================"
echo ""
echo "查看仓库："
echo "  https://github.com/$GITHUB_USER/$REPO_NAME"
echo ""
echo "查看提交历史："
echo "  https://github.com/$GITHUB_USER/$REPO_NAME/commits/main"
echo ""
