# CLAUDE.md — bithumb-trading-bot

## 프로젝트 개요
빗썸 RSI 기반 코인 자동매매 봇. Python 3.13, pybithumb, pandas, ta, SQLite.

## 실행 방법
```bash
cd /Users/jino/ohi-ads-scraper/bithumb-trading-bot
source .venv/bin/activate
python main.py                          # 실전 (백테스트→게이트→매매)
python main.py --backtest               # 백테스트만 (24h봉)
python main.py --backtest --interval 1h # 1시간봉 백테스트
python -m pytest tests/ -v              # 테스트
```

## 디렉토리 구조
```
bithumb-trading-bot/
├── main.py              # 봇 진입점 (startup → 스케줄러)
├── config.py            # 환경변수 + 모든 설정값
├── exchange/            # 빗썸 API 래퍼 (pybithumb)
├── strategy/            # 전략 (RSI) + 게이트 검증
├── backtest/            # 백테스트 엔진 + 데이터 수집
├── risk/                # 손절/익절/MDD 관리
├── logger/              # SQLite 거래 로깅
├── analyzer/            # 거래 분석 + 개선 제안
├── scheduler/           # 주기 실행 스케줄러
└── tests/               # 테스트
```

---

## 상황-행동 규칙 (반드시 준수)

### 코드 작성 규칙
- 함수가 30줄을 넘으면 → 반드시 2개 이상의 함수로 분리한다
- 새 파일을 만들면 → 맨 위에 한 줄 docstring으로 이 파일이 뭐 하는지 적는다
- 외부 API를 호출하면 → 반드시 try/except + @_retry 데코레이터로 감싼다
- 새 의존성을 추가하면 → requirements.txt에 추가하고 이유를 커밋 메시지에 적는다
- 숫자 리터럴이 보이면 → config.py에 상수로 빼고 이름을 붙인다 (매직넘버 금지)

### 전략 코드 규칙
- 새 전략을 만들면 → 반드시 BaseStrategy를 상속하고 generate_signal()을 구현한다
- 전략 파라미터를 변경하면 → 반드시 그리드서치 돌려서 최적값인지 확인한다
- 신호(BUY/SELL)를 생성하면 → 반드시 자연어 reason을 함께 반환한다 (왜 이 신호인지)
- 전략 성과가 의심되면 → analyzer.py로 다차원 분석 돌려서 근거를 확인한다

### 리스크 규칙 (절대 원칙)
- 백테스트 승률 75% 미만이면 → 실전 배포를 절대 하지 않는다 (StrategyGate가 차단)
- 백테스트 샘플이 100건 미만이면 → 통계적으로 무의미하므로 배포하지 않는다
- MDD가 20%를 넘으면 → 즉시 거래를 중단한다
- Profit Factor가 1.5 미만이면 → 전략을 재검토한다
- 실전 승률이 65% 이하로 떨어지면 → 자동으로 봇이 비활성화된다

### 로깅 규칙
- 매수/매도 주문을 실행하면 → 반드시 trade_logger에 기록한다 (예외 없음)
- 시스템 이벤트(오류, MDD초과 등)가 발생하면 → events 테이블에 기록한다
- 봇이 재시작되면 → 미청산 포지션을 DB에서 복구한다

### 테스트 규칙
- 새 기능을 추가하면 → tests/ 폴더에 테스트를 함께 작성한다
- 백테스트 로직을 수정하면 → test_backtest.py가 통과하는지 확인한다
- PR을 올리기 전에 → `python -m pytest tests/ -v` 전체 통과를 확인한다

### 작업 프로세스 규칙
- 큰 작업을 시작하면 → 먼저 계획을 세우고 .claude/memory/에 문서로 저장한다
- 중요한 결정을 내리면 → .claude/memory/에 이유와 함께 기록한다
- 작업이 끝나면 → 체크리스트를 업데이트한다
- 한 번에 1~2개 작업만 한다 (전체를 동시에 하지 않는다)

---

## 기술 스택 상세
- **pybithumb**: 빗썸 공개/인증 API 래퍼
- **pandas**: OHLCV 데이터 처리
- **ta**: 기술적 지표 계산 (RSI, ATR, EMA)
- **schedule**: 주기 실행 스케줄러
- **sqlite3**: 거래 로그 저장 (logger/trades.db)
- **python-dotenv**: .env 환경변수 로딩

## 주요 데이터 흐름
```
빗썸 API → OHLCV → RSI전략 → BUY/SELL/HOLD → RiskManager 체크 → 주문 실행 → TradeLogger 기록
                                                                              ↓
                                                                    TradeAnalyzer 분석
```
