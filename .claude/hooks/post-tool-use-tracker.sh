#!/bin/bash
# 파일 수정(Edit/Write) 후 수정된 파일을 자동 추적하는 훅
set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TRACKER_DIR="$PROJECT_DIR/.claude/memory"
TRACKER_FILE="$TRACKER_DIR/modified-files.log"

mkdir -p "$TRACKER_DIR"

# stdin에서 tool 결과 읽기
INPUT=$(cat)

if [ -z "$INPUT" ]; then
  exit 0
fi

# 현재 시각
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# tool_input에서 file_path 추출 시도
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -n "$FILE_PATH" ]; then
  # 프로젝트 루트 기준 상대 경로로 변환
  REL_PATH=$(echo "$FILE_PATH" | sed "s|$PROJECT_DIR/||")

  # 어떤 모듈인지 판단
  MODULE="unknown"
  case "$REL_PATH" in
    strategy/*) MODULE="strategy" ;;
    exchange/*) MODULE="exchange" ;;
    backtest/*) MODULE="backtest" ;;
    risk/*)     MODULE="risk" ;;
    logger/*)   MODULE="logger" ;;
    analyzer/*) MODULE="analyzer" ;;
    scheduler/*) MODULE="scheduler" ;;
    tests/*)    MODULE="tests" ;;
    main.py)    MODULE="main" ;;
    config.py)  MODULE="config" ;;
  esac

  # 로그에 기록
  echo "[$TIMESTAMP] MODULE=$MODULE FILE=$REL_PATH" >> "$TRACKER_FILE"

  # 리스크 모듈 수정 시 경고
  if [ "$MODULE" = "risk" ]; then
    echo ""
    echo "================================================================"
    echo "  [WARN] 리스크 모듈(risk/) 파일이 수정되었습니다."
    echo "  파일: $REL_PATH"
    echo "  리스크 파라미터 변경은 실전 자금에 직접 영향을 줍니다."
    echo "  반드시 risk/GUIDE.md 규칙을 확인하세요."
    echo "================================================================"
    echo ""
  fi
fi

exit 0
