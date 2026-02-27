#!/bin/bash
# AI 작업 완료(Stop) 시 자동 품질 검사 훅
# 수정된 파일 목록을 확인하고 기본 검사를 수행한다
set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TRACKER_FILE="$PROJECT_DIR/.claude/memory/modified-files.log"

# 수정된 파일이 없으면 종료
if [ ! -f "$TRACKER_FILE" ]; then
  exit 0
fi

# 이번 세션에서 수정된 파일 목록 (최근 100줄)
MODIFIED=$(tail -100 "$TRACKER_FILE" 2>/dev/null | awk '{print $NF}' | sed 's/FILE=//' | sort -u)

if [ -z "$MODIFIED" ]; then
  exit 0
fi

ISSUES=""
PYTHON_FILES=""

for f in $MODIFIED; do
  FULL_PATH="$PROJECT_DIR/$f"

  # 파일이 존재하는지 확인
  if [ ! -f "$FULL_PATH" ]; then
    continue
  fi

  # .py 파일만 검사
  if [[ "$f" == *.py ]]; then
    PYTHON_FILES="$PYTHON_FILES $FULL_PATH"

    # 1. 파일 맨 위에 docstring이 있는지 확인
    FIRST_LINE=$(head -1 "$FULL_PATH" | tr -d '[:space:]')
    if [[ "$FIRST_LINE" != '"""' && "$FIRST_LINE" != "'''" && "$FIRST_LINE" != '#'* ]]; then
      ISSUES="$ISSUES\n  - [$f] 파일 맨 위에 설명(docstring/comment)이 없습니다"
    fi

    # 2. 함수가 30줄을 넘는지 간단 체크
    LONG_FUNCS=$(awk '/^[[:space:]]*(def |async def )/{name=$0; count=0; next} /^[[:space:]]*def |^[[:space:]]*class |^[^[:space:]]/{if(count>30) print name" ("count"줄)"; count=0; next} {count++} END{if(count>30) print name" ("count"줄)"}' "$FULL_PATH")
    if [ -n "$LONG_FUNCS" ]; then
      ISSUES="$ISSUES\n  - [$f] 30줄 초과 함수 발견:"
      while IFS= read -r line; do
        ISSUES="$ISSUES\n      $line"
      done <<< "$LONG_FUNCS"
    fi

    # 3. 매직넘버 체크 (외부 API 호출이나 config 없이 숫자 리터럴 사용)
    # 0, 1, 2, 100 같은 흔한 숫자는 제외
    MAGIC=$(grep -n '[^a-zA-Z_][0-9]\{2,\}\.[0-9]' "$FULL_PATH" | grep -v 'config\.' | grep -v '#' | grep -v 'def \|class \|import \|from ' | head -3)
    # 이 체크는 오탐이 많으므로 주석만 남김
  fi
done

# Python 문법 체크 (간단)
if [ -n "$PYTHON_FILES" ]; then
  for pf in $PYTHON_FILES; do
    SYNTAX_ERR=$(python3 -c "import py_compile; py_compile.compile('$pf', doraise=True)" 2>&1 || true)
    if echo "$SYNTAX_ERR" | grep -q "Error\|SyntaxError"; then
      REL=$(echo "$pf" | sed "s|$PROJECT_DIR/||")
      ISSUES="$ISSUES\n  - [$REL] Python 문법 오류: $(echo "$SYNTAX_ERR" | tail -1)"
    fi
  done
fi

# 결과 출력
echo ""
echo "================================================================"
echo "  [Quality Check] 수정된 파일: $(echo "$MODIFIED" | wc -w | tr -d ' ')개"

if [ -n "$ISSUES" ]; then
  echo ""
  echo "  발견된 이슈:"
  echo -e "$ISSUES"
  echo ""
  echo "  위 이슈를 확인하고 필요 시 수정하세요."
else
  echo "  이슈 없음 — 품질 검사 통과"
fi

echo "================================================================"
echo ""

exit 0
