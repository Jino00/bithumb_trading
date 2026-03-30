#!/bin/bash
# 봇 중지 스크립트
pkill -f "paper_portfolio_manager" 2>/dev/null
tmux kill-session -t "trading-bot" 2>/dev/null
echo "봇 중지 완료"
