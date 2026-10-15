# Contributing to NovelCreationPartner

Thank you for your interest in contributing to NovelCreationPartner! This document provides guidelines and instructions for contributing.

Start with the [development environment and access guide](docs/DEVELOPMENT.md).
Invited collaborators can create branches in this repository; other contributors use a fork.
Use `nvm use`, `npm ci`, and `npm run check` before opening a PR.
The `main` branch requires review by a code owner and passing Quality, Android build,
and iOS build checks. Use feature branches for normal team development.

## 🌟 How to Contribute

### Reporting Bugs

Before creating bug reports, please check the existing issues. When creating a bug report, include:

- A clear and descriptive title
- Detailed steps to reproduce the problem
- Expected behavior vs. actual behavior
- Screenshots if applicable
- Your environment (OS, Node version, React Native version)

### Suggesting Enhancements

Enhancement suggestions are welcome! Please provide:

- A clear and descriptive title
- Detailed description of the proposed feature
- Use cases and benefits
- Any implementation ideas you have

### Pull Requests

1. **Create a branch** from `main` (collaborators) or **fork the repository** (external contributors)
2. **Install dependencies**: `npm ci`
3. **Make your changes** following our coding standards
4. **Run checks**: `npm run check` (ESLint + TypeScript + Jest)
5. **Test manually** on an Android/iOS device or simulator when the change affects the app
6. **Commit** using conventional commit format
7. **Push** your branch
8. **Open a Pull Request** with a clear description

## 📝 Coding Standards

### TypeScript Guidelines

- Use TypeScript for all new files
- Provide proper type annotations
- Avoid using `any` type when possible
- Use interfaces for object shapes
- Use enums for fixed sets of values

### Code Style

- Follow the ESLint configuration
- Use 2 spaces for indentation
- Use single quotes for strings
- Add semicolons at the end of statements
- Format with Prettier (`npx prettier --write <files>`); the config keeps Prettier's default 80-character line width

### Component Guidelines

- Use functional components with hooks
- Keep components focused and single-purpose
- Extract reusable logic into custom hooks
- Use memo for expensive renders
- Type props with TypeScript interfaces (React 19 no longer checks PropTypes)

### Naming Conventions

- **Components**: PascalCase (e.g., `CharacterEditor.tsx`)
- **Files**: PascalCase for components, camelCase for utilities
- **Variables/Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Types/Interfaces**: PascalCase with descriptive names

### File Organization

```
src/
├── components/        # Reusable UI components
├── screens/          # Screen components
├── navigation/       # Navigation configuration
├── services/         # API and business logic
├── hooks/            # Custom React hooks
├── utils/            # Utility functions
├── types/            # TypeScript type definitions
├── constants/        # App constants
└── assets/           # Images, fonts, etc.
```

## 🧪 Testing

- Write unit tests for utility functions
- Write component tests for complex components
- Ensure all tests pass before submitting PR
- Aim for good test coverage

## 📋 Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semi-colons, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(editor): add auto-save functionality for chapters
fix(memory): resolve conflict detection false positives
docs(readme): update installation instructions
style(components): format code with prettier
refactor(api): simplify authentication flow
test(utils): add tests for text formatting utilities
chore(deps): upgrade react-native to 0.87.1
```

## 🌍 Internationalization

- All user-facing strings should be internationalized
- Use i18n library for translations
- Support Chinese (zh-CN) and English (en-US) at minimum
- Place translation files in `src/locales/`

## 🔒 Security

- Never commit sensitive data (API keys, passwords, etc.)
- Use environment variables for configuration
- Follow React Native security best practices
- Report security vulnerabilities privately

## 📞 Getting Help

- Check the [README](README_CN.md) for general information
- Browse [existing issues](https://github.com/MathildaStacy/NovelCreationPartner/issues)
- Create a new issue if you need help

## 📜 Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Accept constructive criticism gracefully

## ✅ PR Checklist

Before submitting your PR, ensure:

- [ ] Code follows the project's style guidelines
- [ ] Self-review of code completed
- [ ] Comments added for complex logic
- [ ] Documentation updated if needed
- [ ] No new warnings generated
- [ ] Tests added/updated and passing
- [ ] Lint checks passing
- [ ] Commit messages follow conventions
- [ ] PR description clearly explains changes

## 🎯 Development Workflow

1. **Setup**: Clone repo and install dependencies
2. **Branch**: Create feature branch from `main`
3. **Develop**: Make changes with frequent commits
4. **Test**: Run tests and manual verification
5. **Lint**: Ensure code quality
6. **PR**: Submit for review
7. **Review**: Address feedback
8. **Merge**: Maintainer merges approved PR

Thank you for contributing to NovelCreationPartner! 🙏
