# backtest/ — 백테스트 엔진 + 데이터 수집

## 파일 구조
- `backtest_engine.py`: 롱온리 포지션 시뮬레이터 + 그리드서치
- `data_fetcher.py`: 과거 OHLCV 데이터 수집 (빗썸 API)

## 규칙
- 전략이 `precompute_signals()` 지원하면 → `_run_fast()` (O(n)) 사용
- 지원 안 하면 → `_run_slow()` (O(n²)) 폴백
- 그리드서치에서 `oversold >= overbought` 조합은 자동 스킵
- `_is_better()` 비교: 최소 거래 수 충족 여부 → 승률 → PF 순서
- 슬리피지/수수료 미포함 — 실전 성과는 백테스트보다 낮을 수 있음
- DataFetcher는 날짜 필터링으로 원하는 기간만 추출

## BacktestResult 구조
```python
BacktestResult(total_trades, winning_trades, losing_trades, win_rate,
               total_return_pct, max_drawdown_pct, avg_profit_pct, profit_factor)
```
