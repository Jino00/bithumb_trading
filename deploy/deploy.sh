#!/bin/bash
# 코드를 Oracle VM으로 전송하는 배포 스크립트
# 사용법: ./deploy/deploy.sh user@<VM_IP>

set -e

if [ -z "$1" ]; then
    echo "사용법: ./deploy/deploy.sh user@<VM_IP>"
    echo "예시:   ./deploy/deploy.sh ubuntu@129.154.xxx.xxx"
    exit 1
fi

TARGET="$1"
REMOTE_DIR="~/bithumb-trading"

echo "=== 배포 시작: $TARGET ==="

# 전송할 디렉토리/파일 목록
INCLUDE=(
    "*.py"
    "analyzer/"
    "backtest/"
    "config.py"
    "dashboard/"
    "evolution/"
    "exchange/"
    "exploration/"
    "learning/"
    "logger/"
    "market/"
    "market_intel/"
    "monitor/"
    "notifier/"
    "portfolio/"
    "requirements.txt"
    "risk/"
    "scheduler/"
    "screener/"
    "stats/"
    "strategy/"
    "tests/"
    "tools/"
    "deploy/"
)

# 제외할 항목
EXCLUDE=(
    "__pycache__"
    "*.pyc"
    ".git"
    ".claude"
    ".gstack"
    ".env"
    "*.db"
    "paper_state.json*"
    "bot.log"
    "paper_trading.log"
    ".venv"
    "*.bak.*"
)

# rsync 명령 구성
RSYNC_CMD="rsync -avz --progress"
for ex in "${EXCLUDE[@]}"; do
    RSYNC_CMD="$RSYNC_CMD --exclude='$ex'"
done

# 전송
echo "코드 전송 중..."
eval $RSYNC_CMD ./ "$TARGET:$REMOTE_DIR/"

# 원격에서 의존성 설치
echo ""
echo "의존성 설치 중..."
ssh "$TARGET" "cd $REMOTE_DIR && source .venv/bin/activate && pip install -r requirements.txt"

# 학습 데이터 전송 (선택)
echo ""
read -p "학습 데이터(.claude/memory/)도 전송? [y/N] " SEND_MEMORY
if [ "$SEND_MEMORY" = "y" ] || [ "$SEND_MEMORY" = "Y" ]; then
    echo "학습 데이터 전송 중..."
    ssh "$TARGET" "mkdir -p $REMOTE_DIR/.claude/memory"
    rsync -avz .claude/memory/ "$TARGET:$REMOTE_DIR/.claude/memory/"
    echo "학습 데이터 전송 완료"
fi

echo ""
echo "=== 배포 완료 ==="
echo ""
echo "다음 단계:"
echo "  1. SSH 접속: ssh $TARGET"
echo "  2. .env 설정: cd $REMOTE_DIR && nano .env"
echo "  3. 봇 시작:  ./deploy/start.sh"
