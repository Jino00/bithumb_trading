# logger/ — 거래 로깅 (SQLite)

## 파일 구조
- `trade_logger.py`: SQLite 기반 거래/이벤트 기록

## 테이블 구조
- `entries`: 매수 진입 (전략명, RSI, 거래량, 추세, 변동성, 지표 스냅샷)
- `exits`: 매도/청산 (청산 이유, PnL%, 보유 시간)
- `events`: 시스템 이벤트 (오류, MDD 초과, 게이트 실패 등)

## 규칙
- 모든 매수/매도는 예외 없이 기록한다 (entries → exits 쌍)
- log_entry()는 entry_id를 반환 → 청산 시 log_exit()에 전달
- 봇 재시작 시 get_open_entry()로 미청산 포지션 복구
- indicators_json 필드에 전체 지표 스냅샷을 JSON으로 저장
- DB 경로: config.DB_PATH (기본값: logger/trades.db)
