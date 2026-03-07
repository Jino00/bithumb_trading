#!/bin/bash
# Meta Ads Intelligence Dashboard — 시작 스크립트
echo "Starting Meta Ads Intelligence Dashboard..."

cd "$(dirname "$0")"

# Backend
echo "Installing backend dependencies..."
cd backend && npm install && node server.js &
BACKEND_PID=$!

# Frontend
echo "Installing frontend dependencies..."
cd ../frontend && npm install && npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend:  http://localhost:3001"
echo "Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
