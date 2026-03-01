import os
from dotenv import load_dotenv

load_dotenv()

# ── 빗썸 API ──────────────────────────────────────────────
BITHUMB_API_KEY = os.getenv("BITHUMB_API_KEY", "")
BITHUMB_SECRET_KEY = os.getenv("BITHUMB_SECRET_KEY", "")

# ── 거래 설정 ─────────────────────────────────────────────
TRADE_COIN = os.getenv("TRADE_COIN", "BTC")          # 거래 코인 심볼
TRADE_AMOUNT = float(os.getenv("TRADE_AMOUNT", "100000"))  # 1회 거래 원화 금액

# ── 리스크 파라미터 ───────────────────────────────────────
STOP_LOSS_PCT = float(os.getenv("STOP_LOSS_PCT", "3.0"))       # 손절 %
TAKE_PROFIT_PCT = float(os.getenv("TAKE_PROFIT_PCT", "5.0"))   # 익절 %
MAX_DRAWDOWN_PCT = float(os.getenv("MAX_DRAWDOWN_PCT", "20.0")) # MDD 한도 %

# ── RSI 전략 파라미터 ─────────────────────────────────────
RSI_PERIOD = 14
RSI_OVERSOLD = 30    # 매수 신호
RSI_OVERBOUGHT = 70  # 매도 신호
RSI_CANDLE_INTERVAL = "1h"  # 캔들 단위

# ── 백테스트 설정 ─────────────────────────────────────────
BACKTEST_DAYS = 365              # 1년 데이터
MIN_WIN_RATE = 75.0              # 전략 게이트 최소 승률 %
MIN_BACKTEST_TRADES = 100        # 전략 게이트 최소 샘플 수
MIN_PROFIT_FACTOR = 1.5          # 전략 게이트 최소 Profit Factor
LIVE_WIN_RATE_THRESHOLD = 65.0   # 실전 승률 비활성화 기준 %

# ── 실전 모니터링 설정 ──────────────────────────────────────
LIVE_MONITOR_WINDOW = 20        # 최근 N건 추적
LIVE_MONITOR_MIN_SAMPLE = 5     # 판단에 필요한 최소 샘플 수
OHLCV_CANDLE_COUNT = 150        # 실시간 신호용 캔들 수

# ── 기술적 지표 임계값 ──────────────────────────────────────
VOLUME_HIGH_RATIO = 1.5         # 거래량 급증 판정 배율
VOLUME_LOW_RATIO = 0.7          # 거래량 저조 판정 배율
ATR_HIGH_VOLATILITY = 3.0       # 고변동성 ATR% 기준
ATR_MEDIUM_VOLATILITY = 1.0     # 중변동성 ATR% 기준
EMA_TREND_THRESHOLD = 0.5       # EMA 크로스 추세 판정 % 기준

# ── 시장 상태 감지 (Market Regime Detection) ──────────────────
ADX_PERIOD = 14                         # ADX 계산 기간
ADX_TREND_THRESHOLD = 25.0              # ADX ≥ 25 → 추세장
ADX_RANGE_THRESHOLD = 20.0              # ADX < 20 → 횡보장

# ── 그리드 전략 (횡보장용) ────────────────────────────────────
GRID_COUNT = 10                         # 그리드 개수
GRID_RANGE_PERIOD = 50                  # 범위 계산에 쓰는 캔들 수
GRID_PROFIT_PER_GRID_PCT = 0.5          # 그리드당 목표 수익 %

# ── 호가창 설정 ─────────────────────────────────────────────
ORDERBOOK_LEVELS = 5            # 호가창 분석 레벨 수

# ── 분석 임계값 ─────────────────────────────────────────────
ANALYSIS_BAD_PERFORMANCE_PCT = 40.0   # 저성과 판정 승률 %
ANALYSIS_DOWNTREND_THRESHOLD = 45.0   # 하락 추세 저성과 판정 %
ANALYSIS_MIN_SAMPLE = 5               # 분석 최소 샘플 수

# ── 백테스트 내부 설정 ──────────────────────────────────────
PROFIT_FACTOR_MAX_CAP = 999.0   # PF 무한대 방지 상한값

# ── 스케줄러 설정 ─────────────────────────────────────────
SCHEDULE_INTERVAL_MINUTES = 60  # 전략 실행 주기 (분)

# ── 페이퍼 트레이딩 ─────────────────────────────────────────
PAPER_TRADING = os.getenv("PAPER_TRADING", "false").lower() == "true"
PAPER_INITIAL_KRW = float(os.getenv("PAPER_INITIAL_KRW", "1000000"))

# ── 알림 설정 ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# ── 적응형 학습 설정 ──────────────────────────────────────
ADAPTIVE_ENABLED = os.getenv("ADAPTIVE_ENABLED", "true").lower() == "true"
ADAPTIVE_INTERVAL_HOURS = 6              # 적응 사이클 주기 (시간)
ADAPTIVE_MIN_TRADES = 10                 # 분석에 필요한 최소 완료 거래 수
ADAPTIVE_POSITION_MIN_MULT = 0.3         # 포지션 최소 배율
ADAPTIVE_POSITION_MAX_MULT = 1.5         # 포지션 최대 배율
ADAPTIVE_BAD_HOUR_WIN_RATE = 40.0        # 시간대 차단 기준 승률 %
ADAPTIVE_DOWNTREND_WIN_RATE = 45.0       # 하락 추세 차단 기준 승률 %
ADAPTIVE_HIGH_VOL_WIN_RATE = 40.0        # 고변동성 포지션 축소 기준 승률 %
ADAPTIVE_CONSEC_LOSS_THRESHOLD = 5       # 연속 손실 포지션 축소 기준

# ── 멀티코인 포트폴리오 설정 ──────────────────────────────
MAX_POSITIONS = int(os.getenv("MAX_POSITIONS", "5"))              # 최대 동시 포지션 수
PORTFOLIO_MDD_PCT = float(os.getenv("PORTFOLIO_MDD_PCT", "25.0")) # 포트폴리오 MDD 한도 %
PER_COIN_ALLOCATION_PCT = 100.0 / MAX_POSITIONS                   # 코인당 자본 비율 % (자동 계산)
SCAN_INTERVAL_MINUTES = 30                                        # 스크리너 주기 (분)
BLACKLIST_TTL_HOURS = 24                                          # 게이트 실패 코인 차단 시간

# ── 스크리너 설정 ────────────────────────────────────────────
SCREENER_MIN_VOLUME_KRW = float(os.getenv("SCREENER_MIN_VOLUME_KRW", "1000000000"))  # 10억원
SCREENER_MIN_RANGE_PCT = float(os.getenv("SCREENER_MIN_RANGE_PCT", "2.0"))
SCREENER_TOP_VOLUME_N = int(os.getenv("SCREENER_TOP_VOLUME_N", "30"))

# ── DB 경로 ───────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "logger", "trades.db")
