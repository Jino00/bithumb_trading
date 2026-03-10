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
MAX_DRAWDOWN_PCT = float(os.getenv("MAX_DRAWDOWN_PCT", "30.0")) # MDD 한도 %

# ── RSI 전략 파라미터 ─────────────────────────────────────
RSI_PERIOD = 14
RSI_OVERSOLD = 30    # 매수 신호
RSI_OVERBOUGHT = 70  # 매도 신호
RSI_CANDLE_INTERVAL = "1h"  # 캔들 단위

# ── 백테스트 설정 ─────────────────────────────────────────
BACKTEST_DAYS = 365              # 1년 데이터
MIN_WIN_RATE = 55.0              # 전략 게이트 최소 승률 %
MIN_BACKTEST_TRADES = 10         # 전략 게이트 최소 샘플 수
MIN_PROFIT_FACTOR = 1.2          # 전략 게이트 최소 Profit Factor
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

# ── 앙상블 시장 레짐 감지 (Ensemble Regime Detection) ─────────
REGIME_WEIGHTS = [0.15, 0.10, 0.25, 0.20, 0.10, 0.10, 0.10]  # 7채널 가중치 (그리드서치 최적)
REGIME_BULL_THRESHOLD = 0.5               # 이 이상이면 BULL (그리드서치 최적)
REGIME_BEAR_THRESHOLD = -0.5              # 이 이하면 BEAR (그리드서치 최적)
REGIME_LOOKAHEAD_BARS = 24                # Ground truth 미래 참조 봉 수
REGIME_PRICE_THRESHOLD = 1.0              # Ground truth ±% 기준
REGIME_EMA_SLOPE_WINDOW = 5               # EMA 기울기 계산 윈도우
REGIME_VOLUME_MA_PERIOD = 20              # 거래량 이동평균 기간

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

# ── 적응형 SL/TP 범위 ────────────────────────────────────
ADAPTIVE_SL_MIN = 1.5                          # 최소 손절 %
ADAPTIVE_SL_MAX = 5.0                          # 최대 손절 %
ADAPTIVE_TP_MIN = 3.0                          # 최소 익절 %
ADAPTIVE_TP_MAX = 8.0                          # 최대 익절 %
ADAPTIVE_SL_STEP = 0.5                         # SL 조정 단위 %
ADAPTIVE_TP_STEP = 0.5                         # TP 조정 단위 %

# ── 적응 효과성 추적 ─────────────────────────────────────
EFFECTIVENESS_MIN_TRADES_AFTER = 10            # 효과 판정 최소 거래 수
EFFECTIVENESS_GOOD_DELTA = 2.0                 # 효과적: 승률 +2%p 이상
EFFECTIVENESS_BAD_DELTA = -5.0                 # 비효과적: 승률 -5%p 이하

# ── 분석 최근 거래 가중치 ─────────────────────────────────
ANALYSIS_RECENCY_MIN_WEIGHT = 0.3              # 가장 오래된 거래 가중치

# ── 멀티코인 포트폴리오 설정 ──────────────────────────────
MAX_POSITIONS = int(os.getenv("MAX_POSITIONS", "5"))              # 최대 동시 포지션 수
PORTFOLIO_MDD_PCT = float(os.getenv("PORTFOLIO_MDD_PCT", "25.0")) # 포트폴리오 MDD 한도 %
PER_COIN_ALLOCATION_PCT = 100.0 / MAX_POSITIONS                   # 코인당 자본 비율 % (자동 계산)
SCAN_INTERVAL_MINUTES = 30                                        # 스크리너 주기 (분)
PAPER_SCAN_INTERVAL_MINUTES = int(os.getenv("PAPER_SCAN_INTERVAL_MINUTES", "30"))  # 페이퍼 스캔 주기
BLACKLIST_TTL_HOURS = 24                                          # 게이트 실패 코인 차단 시간

# ── 스마트 자본 배분 ────────────────────────────────────────────
ALLOC_QUALITY_WEIGHT = 0.7       # 전략 품질 가중 (robust_score 기반)
ALLOC_VOLATILITY_WEIGHT = 0.3    # 코인 변동폭 가중 (range_pct 기반)
ALLOC_MIN_WEIGHT = 0.5           # 최소 배분 가중치 (균등 대비 50%)
ALLOC_MAX_WEIGHT = 1.8           # 최대 배분 가중치 (균등 대비 180%)
ALLOC_CONFIDENCE_TRADES = 20     # 신뢰도 기준 거래 수

# ── 스크리너 설정 ────────────────────────────────────────────
SCREENER_MIN_VOLUME_KRW = float(os.getenv("SCREENER_MIN_VOLUME_KRW", "1000000000"))  # 10억원
SCREENER_MIN_RANGE_PCT = float(os.getenv("SCREENER_MIN_RANGE_PCT", "2.0"))
SCREENER_TOP_VOLUME_N = int(os.getenv("SCREENER_TOP_VOLUME_N", "30"))

# ── DB 경로 ───────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "logger", "trades.db")

# ── 대시보드 설정 ─────────────────────────────────────────
DASHBOARD_PORT = int(os.getenv("DASHBOARD_PORT", "8080"))
DASHBOARD_STATE_PATH = os.path.join(os.path.dirname(__file__), "dashboard", "state.json")
DASHBOARD_PAPER_STATE_PATH = os.path.join(os.path.dirname(__file__), "paper_state.json")

# ── 단타 메타전략 설정 (SCALP) ──────────────────────────────
# S1: RSI 풀백 (Round 3 최적화: 55.2% WR)
SCALP_RSI_PERIOD = 14                          # RSI 계산 기간
SCALP_RSI_PULLBACK_LOW = 25.0                  # 풀백 구간 하한 (35→25, 넓은 구간)
SCALP_RSI_PULLBACK_HIGH = 50.0                 # 풀백 구간 상한
SCALP_RSI_OVERSOLD = 30.0                      # 과매도 바운스 진입
SCALP_RSI_OVERBOUGHT_EXIT = 72.0               # RSI 과매수 청산
SCALP_EMA_SHORT = 20                           # 단기 EMA
SCALP_EMA_LONG = 50                            # 장기 EMA
SCALP_ATR_PERIOD = 14                          # ATR 기간
SCALP_ATR_SL_MULT = 1.5                        # SL = ATR × 배수
SCALP_ATR_TP_MULT = 1.5                        # TP = ATR × 배수 (3.0→1.5, RR 1:1)
SCALP_ATR_TRAIL_MULT = 2.0                     # 트레일링 ATR 배수
SCALP_VOL_MIN_RATIO = 0.5                      # 최소 거래량 비율 (0.8→0.5, 완화)
SCALP_COOLDOWN_BARS = 3                        # 진입 후 쿨다운 봉 수

# S2: 거래량 폭발 (Dux, Round 3 최적화: BULL에서 62.5% WR)
SCALP_VOL_EXPLOSION_MULT = 2.5                 # 거래량 폭발 판정 배수 (2.0→2.5)
SCALP_VOL_MA_PERIOD = 10                       # 거래량 MA 기간
SCALP_VOL_DRY_RATIO = 0.6                      # 거래량 메마름 판정 비율 (0.7→0.6)
SCALP_VOL_BOX_LOOKBACK = 15                    # 박스권 형성 확인 봉 수 (20→15)
SCALP_VOL_RR_RATIO = 2.5                       # 손익비 1:N (3.0→2.5)

# S3: 하이킨아시 (Garcia, Round 8 비용포함 최적화: +9.64%, PF 1.78 ⭐핵심)
SCALP_HA_DOJI_BODY_RATIO = 0.05                # 도지 판정: 몸통/전체 비율 (0.15→0.05, 엄격한 도지)
SCALP_HA_FLAT_WICK_TOL = 0.002                 # 평평한 바닥 허용 오차 비율 (0.0005→0.002, 완화)
SCALP_HA_RR_RATIO = 3.0                        # 손익비 1:N (2.0→3.0, 비용포함 최적)
SCALP_HA_MIN_BEARISH_CANDLES = 3               # 도지 전 최소 음봉 수 (4→3)
SCALP_HA_WEAK_MIN_PCT = 1.0                    # HA_WEAK 청산 최소 이익 % (핵심: 1% 미만이면 청산 안 함)
SCALP_HA_MIN_ATR_PCT = 0.3                     # 최소 ATR/가격 비율 % (저변동성 필터)

# S4: VWAP (Agrawal, Round 3 최적화: 44.1% WR)
SCALP_VWAP_PERIOD = 24                         # VWAP 계산 기간 (봉 수)
SCALP_VWAP_BAND_MULT = 2.0                     # VWAP 밴드 표준편차 배수
SCALP_VWAP_RR_RATIO = 1.5                      # 손익비 1:N (2.0→1.5)
SCALP_VWAP_PULLBACK_TOLERANCE = 0.003          # VWAP 근접 판정 허용 비율 (0.005→0.003)

# S5: BEAR 과매도 반등 (역추세 평균회귀)
SCALP_BEAR_RSI_THRESHOLD = 25.0                # 과매도 RSI 진입 기준
SCALP_BEAR_RSI_PERIOD = 14                     # RSI 계산 기간
SCALP_BEAR_BB_PERIOD = 20                      # 볼린저밴드 기간
SCALP_BEAR_BB_STD = 2.0                        # 볼린저밴드 표준편차 배수
SCALP_BEAR_VOL_SPIKE = 1.5                     # 투매 클라이맥스 거래량 배수
SCALP_BEAR_SL_PCT = 1.5                        # 타이트 손절 %
SCALP_BEAR_TP_PCT = 2.0                        # 빠른 익절 %
SCALP_BEAR_MAX_HOLD_BARS = 10                  # 최대 보유 봉 수
SCALP_BEAR_CONSEC_LOSS_LIMIT = 3               # 연속 손실 시 쿨다운 발동
SCALP_BEAR_COOLDOWN_BARS = 10                  # 쿨다운 봉 수
SCALP_BEAR_POSITION_SCALE = 0.5                # 포지션 크기 축소 배율 (역추세)

# S6: SMMA 리테스트 + 프렉탈 (이동평균선 매매법, 아티브리아 전략)
SCALP_SMMA_SHORT = 21                          # 단기 SMMA 기간
SCALP_SMMA_MID = 50                            # 중기 SMMA 기간
SCALP_SMMA_LONG = 200                          # 장기 SMMA 기간
SCALP_SMMA_RR_RATIO = 1.5                      # 손익비 1:N (영상에서 1:1~1:2)
SCALP_SMMA_MAX_HOLD = 20                       # 최대 보유 봉 수
SCALP_SMMA_TANGLE_TOL = 0.005                  # MA 꼬임 판정 허용 비율 (0.5%)
SCALP_SMMA_RETEST_TOL = 0.005                  # 리테스트 허용 오차 (0.5%)

# 공통
SCALP_USE_REGIME_FILTER = True                 # 레짐 필터 사용 여부
SCALP_ENTRY_MODE = "meta"                      # rsi|volume|ha|vwap|meta

# ── 백테스트 정밀도 설정 ──────────────────────────────────
BACKTEST_FEE_PCT = 0.04                        # 빗썸 편도 수수료 % (양방향 합계 0.08%)
BACKTEST_SLIPPAGE_PCT = 0.05                   # 슬리피지 % (5 bps)

# ── 적응형 페이퍼 트레이딩 설정 ─────────────────────────────
PAPER_TRADING_INTERVAL_MIN = 5                 # 트레이딩 사이클 주기 (분)
PAPER_REPORT_INTERVAL_MIN = 60                 # 상태 보고 주기 (분)
PAPER_OHLCV_COUNT = 500                        # 실시간 캔들 수
PAPER_STARTUP_OHLCV_COUNT = 5000               # 시작 시 전체 평가용 캔들 수
PAPER_REEVAL_COOLDOWN_MIN = 15                 # 재평가 후 쿨다운 (분)
