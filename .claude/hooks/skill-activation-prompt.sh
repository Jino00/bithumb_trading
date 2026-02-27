#!/bin/bash
# 사용자 프롬프트 제출 시 관련 스킬(GUIDE.md)을 자동으로 안내하는 훅
set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
RULES_FILE="$PROJECT_DIR/.claude/skills/skill-rules.json"

# skill-rules.json이 없으면 종료
if [ ! -f "$RULES_FILE" ]; then
  exit 0
fi

# stdin에서 사용자 프롬프트 읽기
USER_PROMPT=$(cat)

if [ -z "$USER_PROMPT" ]; then
  exit 0
fi

# 프롬프트를 소문자로 변환
PROMPT_LOWER=$(echo "$USER_PROMPT" | tr '[:upper:]' '[:lower:]')

MATCHED_GUIDES=""

# 각 스킬의 키워드를 프롬프트와 매칭
check_skill() {
  local skill_name="$1"
  local guide_path="$2"
  shift 2
  local keywords=("$@")

  for kw in "${keywords[@]}"; do
    kw_lower=$(echo "$kw" | tr '[:upper:]' '[:lower:]')
    if echo "$PROMPT_LOWER" | grep -q "$kw_lower"; then
      if [ -f "$PROJECT_DIR/$guide_path" ]; then
        MATCHED_GUIDES="$MATCHED_GUIDES\n  - [$skill_name] $guide_path"
      fi
      return 0
    fi
  done
  return 1
}

# 전략 관련
check_skill "strategy" "strategy/GUIDE.md" "전략" "strategy" "rsi" "신호" "signal" "buy" "sell" "oversold" "overbought" "ema" "atr" || true

# 거래소 API 관련
check_skill "exchange" "exchange/GUIDE.md" "빗썸" "bithumb" "api" "주문" "매수" "매도" "시세" "ohlcv" "호가" "잔고" || true

# 백테스트 관련
check_skill "backtest" "backtest/GUIDE.md" "백테스트" "backtest" "그리드서치" "grid_search" "파라미터" "최적화" || true

# 리스크 관련 (critical — 강제)
check_skill "risk" "risk/GUIDE.md" "손절" "익절" "mdd" "리스크" "stop_loss" "take_profit" "drawdown" || true

# 로거 관련
check_skill "logger" "logger/GUIDE.md" "로그" "기록" "거래기록" "trade_logger" "sqlite" "db" || true

# 분석 관련
check_skill "analyzer" "analyzer/GUIDE.md" "분석" "리포트" "승률" "성과" "analyzer" "report" || true

# 매칭된 가이드가 있으면 안내 메시지 출력
if [ -n "$MATCHED_GUIDES" ]; then
  echo ""
  echo "================================================================"
  echo "  [Auto Skill] 관련 가이드를 반드시 확인하세요:"
  echo -e "$MATCHED_GUIDES"
  echo ""
  echo "  가이드를 Read tool로 먼저 읽은 후 작업을 시작하세요."
  echo "================================================================"
  echo ""
fi

exit 0
