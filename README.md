# Slack AI Agent

Minimal Slack bot that analyzes new members and posts an analysis to a private Slack channel.

## Setup

1. Copy `.env` with your configuration (already present in this workspace).
2. Install dependencies:

```bash
npm install
```

3. Start in development mode:

```bash
npm run dev
```

4. Test analysis endpoint (development only):

```bash
curl -X POST http://localhost:3000/test/analyze-member -H "Content-Type: application/json" -d '{"memberInfo": {"id":"U123","name":"Test User","email":"test.user@example.com","title":"Engineer"}}'
```

## Notes
- Do NOT commit secrets; `.env` is ignored by default in `.gitignore`.
- To push to GitHub, create a new repo and add it as `origin`, then push the `main` branch.
