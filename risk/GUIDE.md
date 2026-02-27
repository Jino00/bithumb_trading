# risk/ — 리스크 관리

## 파일 구조
- `risk_manager.py`: 손절/익절/MDD 관리

## 규칙
- 손절(STOP_LOSS_PCT): 진입가 대비 -N% 하락 → 즉시 청산
- 익절(TAKE_PROFIT_PCT): 진입가 대비 +N% 상승 → 즉시 청산
- MDD 한도(MAX_DRAWDOWN_PCT): 고점 대비 누적 낙폭 초과 → 거래 중단
- `record_trade()` 호출 시 equity/peak 자동 업데이트
- 리스크 파라미터는 config.py에서 관리 (하드코딩 금지)
