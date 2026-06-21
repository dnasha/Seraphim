# Contributing to Seraphim

Thank you for your interest in contributing to Seraphim! This guide will help you get started with the development environment.

## Development Setup

### 1. Prerequisites
- [Bun](https://bun.sh/) (Primary runtime and package manager)
- [Supabase Account](https://supabase.com/) (For database and authentication)

### 2. Clone the Repository
```bash
git clone https://github.com/dnasha/Seraphim.git
cd Seraphim
```

### 3. Install Dependencies
```bash
bun install
```

### 4. Environment Variables
Create a `.env.local` file in the root directory:
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GNEWS_API_KEY=your_gnews_api_key (optional)
```

### 5. Initialize Geodata
```bash
bun run scripts/build-geodata.mjs
```

### 6. Start Development Server
```bash
bun dev
```

## Testing

We use Vitest for testing. Please ensure all tests pass before submitting a PR.

```bash
bun run test
bun run test:accuracy
```

## Pull Request Guidelines

- Create a feature branch from `main`.
- Ensure your code follows the existing style and linting rules.
- Update documentation if necessary.
- Provide a clear description of your changes in the PR.

---

*Note: This is a starting point. More detailed guidelines will be added soon.*
