# Contributing to Code Context Builder

Thank you for your interest in contributing to Code Context Builder! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Code Style Guidelines](#code-style-guidelines)
- [Testing](#testing)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature or bugfix
4. Make your changes
5. Test thoroughly
6. Submit a pull request

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- npm or yarn

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/code_context_builder.git
cd code_context_builder

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

## Project Structure

```
code_context_builder/
├── src/                      # React/TypeScript frontend
│   ├── components/           # React components
│   ├── hooks/                # Custom React hooks
│   └── types/                # TypeScript type definitions
├── src-tauri/                # Rust backend
│   └── src/                  # Rust source files
│       ├── main.rs           # Main entry point
│       ├── scanner.rs        # File scanning logic
│       ├── db.rs             # Database operations
│       └── ...               # Other modules
├── public/                   # Static assets
└── dist/                     # Build output (gitignored)
```

See [DOCUMENTATION.md](DOCUMENTATION.md) for detailed technical documentation.

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-export-functionality`
- `bugfix/fix-scanner-crash`
- `docs/update-readme`

### Commit Messages

Write clear, concise commit messages:
- Use present tense ("Add feature" not "Added feature")
- Keep the first line under 70 characters
- Reference issues when applicable (`Fixes #123`)

Examples:
```
Add CSV export format support

Implement CSV export alongside existing XML/JSON formats.
Includes unit tests and documentation updates.

Fixes #45
```

## Submitting Pull Requests

1. **Update your fork** with the latest changes from main
2. **Test your changes** thoroughly
3. **Update documentation** if needed
4. **Create a pull request** with a clear title and description
5. **Link related issues** in the PR description
6. **Respond to feedback** from reviewers

### Pull Request Template

```markdown
## Description
Brief description of what this PR does

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How has this been tested?

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-reviewed my code
- [ ] Commented complex code sections
- [ ] Updated relevant documentation
- [ ] No new warnings generated
- [ ] Tested on Windows/Mac/Linux (if applicable)
```

## Code Style Guidelines

### TypeScript/React

- Use functional components with hooks
- Use TypeScript for type safety
- Follow existing code formatting (use Prettier if available)
- Keep components small and focused
- Use meaningful variable names

### Rust

- Follow Rust standard style guidelines (`rustfmt`)
- Use `cargo clippy` to catch common issues
- Add comments for complex logic
- Handle errors appropriately (don't unwrap in production code)

### General

- Write self-documenting code
- Add comments for non-obvious logic
- Keep functions small and focused
- Follow DRY (Don't Repeat Yourself) principle

## Testing

### Frontend Testing

```bash
# Run tests (when test suite is added)
npm test
```

### Backend Testing

```bash
cd src-tauri
cargo test
```

### Manual Testing

- Test your changes in development mode
- Build a production version and test
- Test on different operating systems if possible
- Verify no regressions in existing functionality

## Reporting Bugs

When reporting bugs, please include:

1. **Clear title** describing the issue
2. **Steps to reproduce** the bug
3. **Expected behavior** vs **actual behavior**
4. **Screenshots** if applicable
5. **Environment details**:
   - OS and version
   - Node.js version
   - Rust version
   - Application version

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) when available.

## Feature Requests

We welcome feature requests! Please:

1. Check if the feature has already been requested
2. Clearly describe the feature and use case
3. Explain why it would be useful
4. Consider implementation complexity

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) when available.

## Questions?

If you have questions about contributing, feel free to:

- Open a discussion on GitHub
- Comment on relevant issues
- Reach out to maintainers

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Your contributions help make Code Context Builder better for everyone. We appreciate your time and effort!
