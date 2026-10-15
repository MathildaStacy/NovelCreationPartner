# NovelCreationPartner · AI 小说创作伙伴

面向小说创作新手的 Android / iOS 应用，使用 React Native 0.87.1、React 19 和 TypeScript。当前为原生项目骨架，产品功能尚未实现。

AI 协助创意澄清、人物与世界观管理、局部描写和故事一致性检查，作者保留最终决定权。详见[产品规划](README_CN.md)与[架构说明](ARCHITECTURE.md)。

## 开始开发

完整步骤见[开发环境指南](docs/DEVELOPMENT.md)。

```sh
git clone https://github.com/MathildaStacy/NovelCreationPartner.git
cd NovelCreationPartner
nvm install
nvm use
npm ci
npm run check
```

安装原生工具链后：

```sh
source scripts/dev-env.sh  # macOS + nvm；仅影响当前终端
npm run doctor           # 检查工具链
npm start                # 保持此终端运行 Metro
# 在另一个已配置环境的终端中选择一项：
npm run android
npm run ios
```

## 团队协作

- [协作指南](CONTRIBUTING.md)：分支 → Pull Request → CI → 审查 → 合并。
- [权限和分支规则](docs/DEVELOPMENT.md#github-协作权限)：受邀开发者获得 Write 权限。
- [Issues](https://github.com/MathildaStacy/NovelCreationPartner/issues)：报告问题与规划需求。
- [Actions](https://github.com/MathildaStacy/NovelCreationPartner/actions)：质量检查、Android debug APK 和 iOS 模拟器编译，不包含商店发布。

公开仓库允许所有人阅读、克隆和通过 Fork 提交 PR；直接推送开发分支需要协作者权限。使用 [MIT License](LICENSE)。
