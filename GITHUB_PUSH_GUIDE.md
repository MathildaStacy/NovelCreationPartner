# GitHub 仓库推送指南

## ✅ 项目已准备就绪

本地 Git 仓库已完成配置：
- ✅ 项目已初始化为 Git 仓库
- ✅ 远程仓库已配置：`https://github.com/MathildaStacy/NovelCreationPartner.git`
- ✅ 初始提交已完成（提交哈希：8d7ec9a）
- ✅ 分支：`main`

## 🔐 推送到 GitHub 的三种方式

### 方式 1：使用 Personal Access Token (推荐)

#### 1.1 创建 Personal Access Token

1. 访问 GitHub 设置页面：https://github.com/settings/tokens
2. 点击 "Generate new token" → "Generate new token (classic)"
3. 填写 Token 描述（如：NovelCreationPartner Dev）
4. 选择过期时间（建议：90 天或自定义）
5. 勾选权限：
   - ✅ `repo`（完整仓库访问权限）
6. 点击 "Generate token"
7. **立即复制** token（只显示一次，离开页面后无法再查看）

#### 1.2 使用 Token 推送

```bash
cd /Users/boren.fang/Desktop/Personal/NovelAgent/NovelCreationPartner

# 方法 A：临时使用（每次推送都需要输入）
git push -u origin main
# 提示输入用户名：MathildaStacy
# 提示输入密码：粘贴你的 Personal Access Token

# 方法 B：配置 credential helper（推荐，自动记住 token）
git config credential.helper store
git push -u origin main
# 首次输入后会保存，后续自动使用
```

### 方式 2：使用 SSH 密钥（推荐长期使用）

#### 2.1 生成 SSH 密钥

```bash
# 生成 ED25519 密钥（推荐）
ssh-keygen -t ed25519 -C "your_email@example.com"
# 或使用 RSA（兼容性更好）
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# 按提示操作：
# - 保存位置：直接回车（默认 ~/.ssh/id_ed25519）
# - 密码：可选，回车留空或设置密码
```

#### 2.2 添加 SSH 密钥到 GitHub

```bash
# 复制公钥内容
cat ~/.ssh/id_ed25519.pub
# 或
cat ~/.ssh/id_rsa.pub

# 手动复制输出的内容
```

1. 访问 GitHub SSH 设置：https://github.com/settings/keys
2. 点击 "New SSH key"
3. Title：填写描述（如：MacBook Pro）
4. Key：粘贴刚才复制的公钥内容
5. 点击 "Add SSH key"

#### 2.3 修改远程仓库 URL 并推送

```bash
cd /Users/boren.fang/Desktop/Personal/NovelAgent/NovelCreationPartner

# 将 HTTPS URL 改为 SSH URL
git remote set-url origin git@github.com:MathildaStacy/NovelCreationPartner.git

# 验证配置
git remote -v

# 测试 SSH 连接
ssh -T git@github.com
# 看到 "Hi MathildaStacy!" 说明成功

# 推送代码
git push -u origin main
```

### 方式 3：使用 GitHub CLI（最简单）

#### 3.1 安装 GitHub CLI

```bash
# macOS
brew install gh

# 或从官网下载：https://cli.github.com/
```

#### 3.2 登录并推送

```bash
cd /Users/boren.fang/Desktop/Personal/NovelAgent/NovelCreationPartner

# 登录 GitHub（会打开浏览器授权）
gh auth login

# 推送代码
git push -u origin main
```

## 🚀 推送后的验证

推送成功后，访问以下地址确认：
- 仓库主页：https://github.com/MathildaStacy/NovelCreationPartner
- 提交历史：https://github.com/MathildaStacy/NovelCreationPartner/commits/main

你应该能看到：
- ✅ 56 个文件
- ✅ 初始提交信息："chore: initial React Native project setup with documentation"
- ✅ README_CN.md 显示为仓库说明

## 📝 后续协作流程

### 其他开发者克隆项目

```bash
# HTTPS 方式（需要 token）
git clone https://github.com/MathildaStacy/NovelCreationPartner.git

# SSH 方式（需要配置 SSH 密钥）
git clone git@github.com:MathildaStacy/NovelCreationPartner.git

cd NovelCreationPartner
npm install

# iOS 开发者需额外执行
cd ios && pod install && cd ..
```

### 标准开发流程

```bash
# 1. 创建功能分支
git checkout -b feature/your-feature-name

# 2. 开发并提交
git add .
git commit -m "feat: add your feature description"

# 3. 推送分支
git push origin feature/your-feature-name

# 4. 在 GitHub 上创建 Pull Request
# 访问：https://github.com/MathildaStacy/NovelCreationPartner/pulls
```

## 🔧 常见问题解决

### Q1: 推送时提示 "Authentication failed"

**解决方案**：
- 确认使用的是 Personal Access Token，不是账号密码
- 检查 token 是否过期
- 确认 token 有 `repo` 权限

### Q2: 推送时提示 "Permission denied (publickey)"

**解决方案**：
- 使用 `ssh -T git@github.com` 测试连接
- 确认 SSH 公钥已添加到 GitHub
- 检查 SSH agent：`ssh-add -l`
- 重新添加密钥：`ssh-add ~/.ssh/id_ed25519`

### Q3: 推送时提示 "Updates were rejected"

**解决方案**：
```bash
# 先拉取远程更改
git pull origin main --rebase

# 解决冲突后推送
git push origin main
```

### Q4: 仓库是私有的，如何改为公开？

1. 访问仓库设置：https://github.com/MathildaStacy/NovelCreationPartner/settings
2. 滚动到 "Danger Zone"
3. 点击 "Change visibility" → "Make public"
4. 输入仓库名确认

## 📋 推送检查清单

在执行 `git push` 前，确认：
- [ ] 本地代码已提交（`git status` 显示 clean）
- [ ] 提交信息符合规范（Conventional Commits）
- [ ] 敏感信息已排除（检查 .gitignore）
- [ ] 代码通过 lint 检查（`npm run lint`）
- [ ] 测试通过（`npm test`）

## 🎯 下一步

推送成功后，建议：
1. ✅ 设置分支保护规则（Settings → Branches → Add rule）
2. ✅ 启用 Issues 和 Projects（Settings → Features）
3. ✅ 添加 CODEOWNERS 文件（指定代码审查者）
4. ✅ 配置 GitHub Actions（自动化测试和构建）
5. ✅ 邀请协作者（Settings → Collaborators）

---

**需要帮助？** 在 [Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues) 提问或查看 GitHub 官方文档：https://docs.github.com/
