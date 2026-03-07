# Meta Ads Intelligence Dashboard

AI-powered Meta Ads marketing intelligence platform with competitor insights and automated recommendations.

## Quick Start

```bash
# Option 1: Start script
./start.sh

# Option 2: Manual
cd backend && npm install && node server.js &
cd frontend && npm install && npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:5173

## Setup

1. Add your Anthropic API key to `backend/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

2. Without an API key, the app uses mock data for AI analysis.

## Features

- Campaign performance tracking with color-coded KPIs
- AI-powered analysis with MAINTAIN/MODIFY/PAUSE verdicts
- Competitor ad intelligence via web search
- Real-time Meta Ads trends and benchmarks
- Campaign CRUD with modal editor
