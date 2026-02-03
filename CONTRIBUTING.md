# Contributing to PickAFlick

First off, thank you for considering contributing to PickAFlick! 🎉

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected behavior** vs **actual behavior**
- **Screenshots** if applicable
- **Environment details** (OS, browser, Node version)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear title and description**
- **Use case** - why would this be useful?
- **Possible implementation** if you have ideas
- **Mockups or examples** if applicable

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow the existing code style**
3. **Write clear commit messages**
4. **Test your changes** thoroughly
5. **Update documentation** if needed
6. **Submit the pull request**

## Development Setup

1. Fork and clone the repo
   ```bash
   git clone https://github.com/YOUR_USERNAME/PickAFlick.git
   cd PickAFlick
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Set up your `.env` file (see `.env.example`)

4. Create a new branch
   ```bash
   git checkout -b feature/your-feature-name
   ```

5. Make your changes and test them
   ```bash
   npm run dev
   npm run check  # TypeScript type checking
   ```

## Coding Guidelines

### TypeScript
- Use TypeScript for all new code
- Define proper types, avoid `any`
- Use Zod schemas for API validation

### React Components
- Use functional components with hooks
- Keep components focused and reusable
- Use Tailwind for styling (avoid inline styles)
- Follow the design guidelines in `design_guidelines.md`

### Code Style
- Use meaningful variable and function names
- Write comments for complex logic
- Keep functions small and focused
- Use ES6+ features

### Git Commits
- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Reference issues and pull requests when relevant

Example commit messages:
```
Add trailer autoplay feature
Fix swipe animation on mobile devices
Update README with deployment instructions
Refactor API error handling
```

## Project Structure

```
PickAFlick/
├── client/          # Frontend React app
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── hooks/       # Custom hooks
│   │   └── lib/         # Utilities
├── server/          # Backend Express app
│   ├── routes.ts    # API routes
│   ├── db.ts        # Database
│   ├── tmdb.ts      # TMDB integration
│   └── ai-recommender.ts # AI recommendations
└── shared/          # Shared types/schemas
```

## Testing

Currently, the project doesn't have automated tests (contributions welcome!). When submitting changes:

1. Manually test all affected features
2. Test on different screen sizes (mobile, tablet, desktop)
3. Verify TypeScript types with `npm run check`
4. Test the build with `npm run build`

## Areas We'd Love Help With

- [ ] Unit and integration tests
- [ ] E2E tests with Playwright or Cypress
- [ ] Accessibility improvements
- [ ] Performance optimizations
- [ ] Additional movie filters and sorting options
- [ ] User authentication system
- [ ] Social features (ratings, reviews, lists)
- [ ] Internationalization (i18n)
- [ ] Mobile app (React Native)
- [ ] Documentation improvements

## Questions?

Feel free to open an issue with the `question` label, or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
