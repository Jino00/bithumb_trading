# bithumb-trading-bot

빗썸(Bithumb) 거래소 자동화 트레이딩 봇.
RSI 기반 전략, 백테스트 승률 75% 게이트, 전체 거래 SQLite 로깅.

## 특징

- **전략 게이트**: 1년 백테스트 승률 75% 이상 전략만 실전 배포
- **완전 로깅**: 모든 거래·오류를 SQLite에 기록
- **리스크 관리**: 손절 -3%, 익절 +5%, MDD 20% 자동 중단
- **분석기**: 거래 데이터 분석 후 전략 개선 제안 출력

## 빠른 시작

```bash
pip install -r requirements.txt
cp .env.example .env   # API 키 입력
python -m backtest.backtest_engine   # 전략 검증
python main.py                        # 봇 실행
```

## 환경 변수 (.env)

```
BITHUMB_API_KEY=your_api_key
BITHUMB_SECRET_KEY=your_secret_key
TRADE_COIN=BTC
TRADE_AMOUNT=100000
STOP_LOSS_PCT=3.0
TAKE_PROFIT_PCT=5.0
MAX_DRAWDOWN_PCT=20.0
```

## 프로젝트 구조

```
bithumb-trading-bot/
├── main.py                   # 실행 진입점
├── config.py                 # 설정 로드
├── exchange/
│   └── bithumb_client.py     # 빗썸 API 클라이언트
├── strategy/
│   ├── base_strategy.py      # 전략 기본 클래스
│   ├── rsi_strategy.py       # RSI 전략
│   └── strategy_gate.py     # 승률 75% 게이트
├── backtest/
│   ├── backtest_engine.py    # 백테스트 엔진
│   └── data_fetcher.py       # 과거 데이터 수집
├── logger/
│   └── trade_logger.py       # 거래 로거 (SQLite)
├── analyzer/
│   └── analyzer.py           # 분석 및 개선 제안
├── risk/
│   └── risk_manager.py       # 리스크 관리
├── scheduler/
│   └── schedule_config.py    # 스케줄 설정
└── tests/
    └── test_backtest.py      # 백테스트 테스트
```

## 새 전략 추가

1. `strategy/base_strategy.py`의 `BaseStrategy`를 상속
2. `generate_signal()` 구현
3. `strategy_gate.py`로 백테스트 승률 검증 (75% 이상)
4. `main.py`에서 전략 교체
