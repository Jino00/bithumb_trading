#!/bin/bash
# 봇 시작 스크립트 (tmux 세션으로 백그라운드 실행)
# 사용법: ./deploy/start.sh

set -e
cd "$(dirname "$0")/.."

# .env 확인
if [ ! -f .env ]; then
    echo "ERROR: .env 파일이 없습니다."
    echo ""
    echo "최소 설정:"
    echo '  GEMINI_API_KEY=your_key_here'
    echo ""
    echo "nano .env 로 생성하세요."
    exit 1
fi

# venv 활성화
source .venv/bin/activate

# 이전 프로세스 종료
pkill -f "paper_portfolio_manager" 2>/dev/null || true
sleep 1

# tmux 세션 시작
SESSION="trading-bot"
tmux kill-session -t "$SESSION" 2>/dev/null || true

tmux new-session -d -s "$SESSION" -n "bot" \
    "cd $(pwd) && source .venv/bin/activate && python3 -u -c \"
from paper_portfolio_manager import PaperPortfolioManager
from datetime import datetime, timedelta
manager = PaperPortfolioManager(
    initial_capital=10_000_000_000,
    max_positions=70,
    verbose=False,
)
success = manager.startup()
if success:
    manager.run()
\" 2>&1 | tee paper_trading.log"

# 모니터링 창 추가
tmux new-window -t "$SESSION" -n "monitor" \
    "cd $(pwd) && watch -n 30 'python3 -c \"
import json
with open(\\\"paper_state.json\\\") as f:
    d = json.load(f)
k = d[\\\"kpi\\\"]
e = d.get(\\\"exploration\\\", {})
p = d.get(\\\"positions\\\", [])
print(f\\\"총자산: {k[\\\\\\\"total_value\\\\\\\"]:,.0f}원 ({k[\\\\\\\"total_return_pct\\\\\\\"]:+.2f}%)\\\")
print(f\\\"메인: {len(p)}개 | 탐색: {e.get(\\\\\\\"active_slots\\\\\\\",0)}개\\\")
print(f\\\"거래: {k[\\\\\\\"total_trades\\\\\\\"]}건 | 승률: {k[\\\\\\\"win_rate\\\\\\\"]:.1f}%\\\")
\"'"

echo ""
echo "=== 봇 시작 완료 ==="
echo ""
echo "  tmux attach -t $SESSION     # 실시간 로그 보기"
echo "  tmux attach -t $SESSION:1   # 모니터링 대시보드"
echo ""
echo "  Ctrl+B D                    # tmux에서 나오기 (봇은 계속 실행)"
echo "  ./deploy/stop.sh            # 봇 중지"
