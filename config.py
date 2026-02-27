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

# ── DB 경로 ───────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "logger", "trades.db")
