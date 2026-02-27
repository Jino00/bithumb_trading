# strategy/ — 매매 전략 모듈

## 파일 구조
- `base_strategy.py`: 전략 추상 클래스 (모든 전략이 상속)
- `rsi_strategy.py`: RSI + EMA + ATR + 거래량 전략 구현
- `strategy_gate.py`: 실전 배포 전 4조건 검증 게이트

## 규칙
- 새 전략 추가 시 → 반드시 `BaseStrategy`를 상속하고 `generate_signal(df) -> Signal` 구현
- Signal 타입은 `Literal["BUY", "SELL", "HOLD"]` 고정 — 다른 값 사용 금지
- 전략마다 `precompute_signals(df)` 구현 권장 → BacktestEngine에서 O(n) 고속 경로 사용
- 신호 생성 시 `SignalContext`로 감싸서 이유(reason) + 지표 스냅샷 함께 반환
- StrategyGate 4조건: 승률≥75%, 샘플≥100, MDD≤20%, PF≥1.5 — 하나라도 미달 시 배포 차단

## 패턴
```python
class MyStrategy(BaseStrategy):
    def generate_signal(self, df: pd.DataFrame) -> Signal:
        # 지표 계산 → 조건 판단 → "BUY" | "SELL" | "HOLD" 반환
```
