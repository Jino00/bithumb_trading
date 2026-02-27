# analyzer/ — 거래 분석 + 개선 제안

## 파일 구조
- `analyzer.py`: 다차원 분석기 + 자연어 리포트 생성

## 분석 항목
1. 전략별 승률/PF
2. RSI 진입값 구간별 성과 (5단위 버킷)
3. 시간대별 성과 분포 (0~23시)
4. 추세별 성과 (UPTREND/DOWNTREND/SIDEWAYS)
5. 변동성별 성과 (HIGH/MEDIUM/LOW)
6. 청산 패턴 (STOP_LOSS/TAKE_PROFIT/RSI_SIGNAL)
7. 파라미터 개선 제안 (최대 10개)

## 규칙
- trade_logger.get_completed_trades()의 반환값을 입력으로 받는다
- pnl_pct가 None인 거래는 자동 필터링
- 개선 제안은 데이터 기반으로만 생성 (감에 의존하지 않음)
- _best_rsi_bucket()은 최소 5건 이상인 구간만 후보로 삼는다
