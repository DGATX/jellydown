# Contributing to JellyDown

Thank you for your interest in contributing to JellyDown! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm
- ffmpeg (for testing video muxing)
- A Jellyfin server (for integration testing)

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/jellydown.git
   cd jellydown/web
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:6942 in your browser

## Project Structure

```
web/
├── client/           # Frontend (vanilla JavaScript)
│   ├── index.html    # Main HTML file
│   ├── js/
│   │   ├── app.js    # Main application logic
│   │   ├── api.js    # API client
│   │   └── download.js # WebSocket & download management
│   └── css/
│       └── styles.css # All styles
├── server/           # Backend (TypeScript)
│   ├── index.ts      # Express server entry point
│   ├── config.ts     # Configuration management
│   ├── routes/       # API route handlers
│   ├── services/     # Business logic
│   ├── middleware/   # Express middleware
│   ├── websocket/    # WebSocket handlers
│   └── models/       # TypeScript types
└── server/__tests__/ # Test files
```

## Code Style

### TypeScript (Backend)

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await over raw promises
- Add types for all function parameters and return values
- Use meaningful variable names

### JavaScript (Frontend)

- Use vanilla JavaScript (no frameworks)
- Follow existing patterns in the codebase
- Keep functions small and focused
- Comment complex logic

### CSS

- Use CSS custom properties (variables) for colors and spacing
- Follow existing naming conventions
- Keep selectors specific but not overly complex

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring

### Commit Messages

Write clear, concise commit messages:

```
Add batch download progress indicator

- Show overall progress for batch downloads
- Display count of completed/total items
- Add cancel all button for batch operations
```

### Testing

Run tests before submitting:

```bash
npm test
```

All tests must pass. Add tests for new features when possible.

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Run tests and ensure they pass
4. Update documentation if needed
5. Submit a pull request

#### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring

## Testing
How was this tested?

## Screenshots (if applicable)
```

## Reporting Issues

### Bug Reports

Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser/OS information
- Server logs if applicable

### Feature Requests

Include:
- Clear description of the feature
- Use case / why it's needed
- Any implementation ideas (optional)

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Focus on the code, not the person

## Questions?

Feel free to open an issue for questions or discussions about the project.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
