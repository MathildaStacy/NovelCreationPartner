# 快速上手指南

本文档帮助新加入的开发者快速熟悉项目并开始开发。

## 开发环境准备

### 必备工具

1. **Node.js**：建议使用 nvm 安装，版本 >= 18
2. **Git**：代码版本控制
3. **React Native 开发环境**：
   - **iOS**（仅 macOS）：Xcode、CocoaPods
   - **Android**：Android Studio、Java JDK

### 首次安装

```bash
# 1. 克隆项目
git clone https://github.com/MathildaStacy/NovelCreationPartner.git
cd NovelCreationPartner

# 2. 使用正确的Node版本
nvm install
nvm use

# 3. 安装依赖
npm ci

# 4. 运行代码检查（确保环境正常）
npm run check

# 5. iOS额外步骤（仅macOS）
cd ios && pod install && cd ..
```

## 启动开发

### 1. 启动Metro服务器

```bash
# 启动Metro bundler（保持此终端运行）
npm start
```

### 2. 运行应用

**在新的终端窗口中：**

```bash
# Android
npm run android

# iOS（macOS only）
npm run ios
```

## 项目结构速览

```
src/
├── components/          # 可复用UI组件
├── constants/           # 全局常量（颜色、主题）
├── mock/               # 测试数据
├── navigation/         # 导航配置
├── screens/            # 页面组件
│   ├── home/          # 首页
│   ├── project/       # 项目管理（列表、详情、创建）
│   └── settings/      # 设置
├── store/             # Zustand状态管理
└── types/             # TypeScript类型定义
```

## 常用开发命令

```bash
# 代码质量检查
npm run lint              # ESLint检查
npm run typecheck         # TypeScript类型检查
npm run check             # 运行所有检查

# 代码格式化
npm run format            # Prettier格式化

# 清理缓存（遇到问题时）
npm run clean             # 清理缓存
npm run clean:android     # 清理Android缓存
npm run clean:ios         # 清理iOS缓存
```

## 开发工作流

### 1. 创建功能分支

```bash
# 从main分支创建新分支
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

### 2. 开发与提交

```bash
# 添加修改
git add .

# 使用规范的提交信息
git commit -m "feat(module): add new feature"

# 推送到远程
git push origin feature/your-feature-name
```

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat(scope): 新功能`
- `fix(scope): Bug修复`
- `docs: 文档更新`
- `style: 代码格式（不影响功能）`
- `refactor(scope): 代码重构`
- `test: 测试相关`
- `chore: 构建/工具配置`

示例：
```bash
git commit -m "feat(project): add project creation form"
git commit -m "fix(navigation): resolve tab navigation issue"
git commit -m "docs: update quick start guide"
```

### 3. 创建Pull Request

1. 在GitHub上创建Pull Request
2. 等待CI检查通过
3. 请求团队成员审查
4. 根据反馈修改
5. 合并到main分支

## 技术栈快速了解

### 核心技术

- **React Native 0.87.1**：跨平台移动开发框架
- **TypeScript**：类型安全的JavaScript超集
- **Zustand**：轻量级状态管理
- **React Navigation 7.x**：导航库
- **gluestack-ui**：UI组件库

### 状态管理示例（Zustand）

```typescript
// 使用store
import {useProjectStore} from '../store/projectStore';

function MyComponent() {
  const {projects, fetchProjects} = useProjectStore();
  
  useEffect(() => {
    fetchProjects();
  }, []);
  
  return <ProjectList projects={projects} />;
}
```

### 导航示例

```typescript
import {useNavigation} from '@react-navigation/native';

function MyScreen() {
  const navigation = useNavigation();
  
  const handlePress = () => {
    navigation.navigate('ProjectDetail', {projectId: '123'});
  };
  
  return <Button onPress={handlePress}>查看详情</Button>;
}
```

## 常见问题

### Q: Metro bundler报错"port 8081 already in use"

```bash
# 方法1：杀掉占用端口的进程
npx react-native start --reset-cache

# 方法2：使用其他端口
npx react-native start --port 8082
```

### Q: Android build失败

```bash
# 清理Android缓存
cd android && ./gradlew clean && cd ..
npm run clean

# 重新安装依赖
rm -rf node_modules
npm ci
```

### Q: iOS pod install失败

```bash
# 清理CocoaPods缓存
cd ios
pod deintegrate
pod install
cd ..
```

### Q: TypeScript类型错误

```bash
# 运行类型检查查看详细错误
npm run typecheck

# 确保所有类型文件都有正确的导入
```

## 开发资源

### 官方文档
- [React Native 文档](https://reactnative.dev/)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [React Navigation](https://reactnavigation.org/)
- [Zustand](https://zustand-demo.pmnd.rs/)
- [gluestack-ui](https://gluestack.io/)

### 项目文档
- [产品说明](./PRODUCT_BRIEF.md) - 了解产品定位
- [架构设计](../ARCHITECTURE.md) - 技术架构
- [开发进度](./DEVELOPMENT_PROGRESS.md) - 当前进度
- [协作指南](../CONTRIBUTING.md) - 如何贡献

## 下一步

1. 阅读[产品说明](./PRODUCT_BRIEF.md)了解产品目标
2. 查看[开发进度](./DEVELOPMENT_PROGRESS.md)了解当前状态
3. 在GitHub Issues中认领任务
4. 开始你的第一个功能开发！

## 需要帮助？

- 查看GitHub Issues中的问题和讨论
- 联系项目维护者
- 参与团队讨论

---

**祝编码愉快！** 🚀
