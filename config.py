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
MIN_BACKTEST_TRADES = 30         # 전략 게이트 최소 샘플 수 (10→30, 통계적 유의성)
MIN_PROFIT_FACTOR = 1.3          # 전략 게이트 최소 Profit Factor (1.2→1.3, 수수료 커버 마진)
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
ADAPTIVE_INTERVAL_HOURS = 6              # 적응 사이클 주기 (시간) — 시간 기반 폴백
ADAPTIVE_TRADE_TRIGGER = 1               # ★ 거래 1건마다 즉시 학습 (5→1, 모든 거래에서 배움)
ADAPTIVE_MIN_TRADES = 3                  # ★ 분석 최소 거래 수 (5→3, 더 빠른 학습 시작)
ADAPTIVE_POSITION_MIN_MULT = 0.3         # 포지션 최소 배율
ADAPTIVE_POSITION_MAX_MULT = 2.0         # ★ 포지션 최대 배율 (1.5→2.0, 확신 시 공격적)
ADAPTIVE_BAD_HOUR_WIN_RATE = 0.0         # ★ 시간대 차단 비활성화 (데이터 부족 — 이른 판단 방지)
ADAPTIVE_BAD_HOUR_MIN_TRADES = 9999      # ★ 사실상 차단 안 함
ADAPTIVE_DOWNTREND_WIN_RATE = 35.0       # ★ 하락추세 차단 기준 (45→35%, 바운스 기회 보존)
ADAPTIVE_DOWNTREND_SCALE = 0.5           # ★ 하락추세 포지션 축소 배율 (차단→축소)
ADAPTIVE_HIGH_VOL_WIN_RATE = 40.0        # 고변동성 포지션 축소 기준 승률 %
ADAPTIVE_CONSEC_LOSS_THRESHOLD = 3       # ★ 연속 손실 축소 기준 (5→3, 빠른 리스크 감소)

# ── 적응형 SL/TP 범위 ────────────────────────────────────
ADAPTIVE_SL_MIN = 1.5                          # 최소 손절 %
ADAPTIVE_SL_MAX = 5.0                          # 최대 손절 %
ADAPTIVE_TP_MIN = 3.0                          # 최소 익절 %
ADAPTIVE_TP_MAX = 8.0                          # 최대 익절 %
ADAPTIVE_SL_STEP = 0.5                         # SL 조정 단위 %
ADAPTIVE_TP_STEP = 0.5                         # TP 조정 단위 %

# ── 인사이트 기반 거래 반영 (학습→행동 피드백 루프) ──────────
INSIGHT_STRATEGY_REGIME_BLOCK_WR = 20.0        # 전략×레짐 차단 승률 임계치 %
INSIGHT_STRATEGY_REGIME_MIN_TRADES = 10        # 차단 판단 최소 거래 수 (3→10, 과적합 방지)
INSIGHT_TIER_SCALE_WR = 25.0                   # 티어별 포지션 축소 승률 임계치 %
INSIGHT_TIER_SCALE_MIN_TRADES = 10             # 축소 판단 최소 거래 수 (3→10, 과적합 방지)
INSIGHT_SL_EXIT_RATIO_THRESHOLD = 0.5          # SL 청산 비율 > 이 값이면 SL 확대
INSIGHT_SL_WIDEN_STEP = 0.3                    # SL 확대 단위 %
INSIGHT_HOUR_BLOCK_WR = 0.0                    # ★ 시간대 차단 비활성화
INSIGHT_HOUR_BLOCK_MIN_TRADES = 9999           # ★ 사실상 차단 안 함
INSIGHT_CONSEC_LOSS_COOLDOWN = 5               # 연속 N패 시 쿨다운 (거래 일시 중단)

# ── 통합 인사이트 엔진 (외부 리서치) ─────────────────────
INSIGHT_MIN_TRUST_SCORE = 40                   # 외부 인사이트 최소 신뢰도 (0-100)
INSIGHT_APPLY_TRUST_SCORE = 60                 # 직접 적용 최소 신뢰도
INSIGHT_INTERNAL_WEIGHT = 0.7                  # 내부 vs 외부 가중치 (전략 점수 병합)
INSIGHT_EXTERNAL_WEIGHT = 0.3
DAILY_RESEARCH_HOUR = 6                        # 일일 리서치 실행 시각 (KST)
DAILY_RESEARCH_MAX_SOURCES = 5                 # 일일 리서치 최대 소스 수

# ── NotebookLM 인사이트 기반 필터 ────────────────────────
SCALP_EMA_TREND_FILTER = 200                   # 200 EMA 추세 필터 (위에서만 롱 진입)
SCALP_DOJI_BODY_RATIO = 0.1                    # 도지 캔들 판정 (몸통/전체 < 10%)
MANUAL_BLOCKED_HOURS = set()                    # ★ 수동 차단 없음 (모든 시간대 허용)

# ── 적응 효과성 추적 ─────────────────────────────────────
EFFECTIVENESS_MIN_TRADES_AFTER = 10            # 효과 판정 최소 거래 수
EFFECTIVENESS_GOOD_DELTA = 2.0                 # 효과적: 승률 +2%p 이상
EFFECTIVENESS_BAD_DELTA = -5.0                 # 비효과적: 승률 -5%p 이하

# ── 분석 최근 거래 가중치 ─────────────────────────────────
ANALYSIS_RECENCY_MIN_WEIGHT = 0.3              # 가장 오래된 거래 가중치

# ── 멀티코인 포트폴리오 설정 ──────────────────────────────
MAX_POSITIONS = int(os.getenv("MAX_POSITIONS", "70"))             # 메인 70 + 탐색 30 = 100 슬롯
MIN_ACTIVATION_SCORE = float(os.getenv("MIN_ACTIVATION_SCORE", "3.0"))  # ★ 전략 평가 최소 점수 (0→3, 저품질 코인 필터)
MIN_COIN_ALLOCATION_KRW = int(os.getenv("MIN_COIN_ALLOCATION", "500000"))  # ★ 코인당 최소 50만원
PORTFOLIO_MDD_PCT = float(os.getenv("PORTFOLIO_MDD_PCT", "25.0")) # 포트폴리오 MDD 한도 %
PER_COIN_ALLOCATION_PCT = 100.0 / MAX_POSITIONS                   # 코인당 자본 비율 % (자동 계산, 참고용)
SCAN_INTERVAL_MINUTES = 30                                        # 스크리너 주기 (분)
PAPER_SCAN_INTERVAL_MINUTES = 1                # 페이퍼 풀 스캔 주기 — 1분마다 전체 코인 발굴
PAPER_QUICK_SCAN_INTERVAL_MINUTES = 1  # ★ 퀵 스캔 주기 — 1분마다 핫 리스트만 재스캔
BLACKLIST_TTL_HOURS = 2                                           # ★ 차단 시간 (24→2h, 빠른 재시도)

# ── 스마트 자본 배분 ────────────────────────────────────────────
ALLOC_QUALITY_WEIGHT = 0.7       # 전략 품질 가중 (robust_score 기반)
ALLOC_VOLATILITY_WEIGHT = 0.3    # 코인 변동폭 가중 (range_pct 기반)
ALLOC_MIN_WEIGHT = 0.5           # 최소 배분 가중치 (균등 대비 50%)
ALLOC_MAX_WEIGHT = 2.0           # 최대 배분 가중치 (균등 대비 200%, 바닥 구간 BTC 집중)
ALLOC_CONFIDENCE_TRADES = 20     # 신뢰도 기준 거래 수

# ── 고정 슬롯 자본 비중 가이드 (인사이트 기반) ──────────────────
# 2026-03 극단적 공포 구간: BTC 50%, SOL 30%, ETH 20%
FIXED_SLOT_WEIGHTS = {"BTC": 2.5, "SOL": 1.5, "ETH": 1.0}  # 비중 가중치

# ── 스크리너 설정 ────────────────────────────────────────────
SCREENER_MIN_VOLUME_KRW = float(os.getenv("SCREENER_MIN_VOLUME_KRW", "100000000"))  # 1억원 (10억→1억, 70슬롯 확보)
SCREENER_MIN_RANGE_PCT = float(os.getenv("SCREENER_MIN_RANGE_PCT", "0.5"))          # 0.5% (2%→0.5%, 더 많은 코인)
SCREENER_MIN_PRICE_KRW = 10                     # ★ 최소 가격 (10원 미만은 슬리피지 과다)

# ── 영구 블랙리스트 (성과 데이터 기반) ──────────────────────────
PERMANENT_BLACKLIST = {"A8"}                      # 35건 57% WR이지만 -2,338만원 (이길 때 적게, 질 때 크게)

# ── SIDEWAYS 레짐 포지션 축소 ─────────────────────────────────
SIDEWAYS_POSITION_SCALE = 0.5                     # 60건 48% WR, -2,461만원 → 50% 축소

# ── 코인별 성과 기반 자동 차단 ─────────────────────────────────
COIN_PERF_MIN_TRADES = 5                          # 차단 판단 최소 거래 수
COIN_PERF_BLOCK_WR = 30.0                         # 승률 30% 미만이면 차단
COIN_PERF_BLOCK_LOSS_KRW = -500_000               # 총 PnL -50만원 미만이면 차단
COIN_PERF_BLOCK_TTL_HOURS = 6                     # 성과 부진 차단 TTL (시간)

# ── 연속 손실 점진적 축소 ─────────────────────────────────────
CONSEC_LOSS_SCALES = {2: 0.7, 3: 0.5, 4: 0.3}    # 연패 수 → 포지션 배율

# ── 보유 시간 자동 청산 ──────────────────────────────────────
MAX_HOLD_MINUTES = 60                             # 1시간 초과 + 손실 → TIME_SL (240→60, 자본 회전율 개선)

SCREENER_HOT_RANGE_PCT = 15.0                   # ★ 변동폭 15%+ → HOT (실시간 대응 모드)
SCREENER_EXTREME_RANGE_PCT = 40.0               # ★ 변동폭 40%+ → EXTREME (초고속 대응 모드)

# ── 급등락 코인 실시간 대응 설정 (6개월 788건 그리드서치 최적화) ──
VOLATILE_FAST_INTERVAL = "5m"                   # HOT/EXTREME 코인 포지션 보유 시 모니터링 간격
VOLATILE_FAST_CYCLE_SEC = 10                    # 급등락 코인 포지션 모니터링 주기 (초)
VOLATILE_MOMENTUM_EXIT_BARS = 3                 # 모멘텀 반전 확인 봉 수

# ★ 티어별 최적 파라미터 (6개월 그리드서치 결과)
# NORMAL (변동폭 <15%): 트레일링 2.5%, 활성화 1.0%, SL ×0.5, TP ×1.5
#   → 610건, 승률 43.3%, PF 1.13, 기존 대비 +41.6% 개선
VOLATILE_NORMAL_TRAIL_PCT = 2.5
VOLATILE_NORMAL_ACTIVATE_PCT = 1.0
VOLATILE_NORMAL_SL_MULT = 0.5
VOLATILE_NORMAL_TP_MULT = 1.5

# HOT (변동폭 15~40%): 트레일링 4.0%, 활성화 0.5%, SL ×0.5, TP ×2.0
#   → 137건, 승률 56.2%, PF 2.43, 평균 PnL +1.45%
VOLATILE_HOT_TRAIL_PCT = 4.0
VOLATILE_HOT_ACTIVATE_PCT = 0.5
VOLATILE_HOT_SL_MULT = 0.5
VOLATILE_HOT_TP_MULT = 2.0

# EXTREME (변동폭 40%+): 트레일링 1.5%, 활성화 3.0%, SL ×0.5, TP ×1.0
#   → 41건, 승률 56.1%, PF 3.26, 평균 PnL +2.26%
VOLATILE_EXTREME_TRAIL_PCT = 1.5
VOLATILE_EXTREME_ACTIVATE_PCT = 3.0
VOLATILE_EXTREME_SL_MULT = 0.5
VOLATILE_EXTREME_TP_MULT = 1.0

# 하위 호환용 기본값 (NORMAL 기준)
VOLATILE_TRAILING_STOP_PCT = VOLATILE_NORMAL_TRAIL_PCT
VOLATILE_TRAILING_ACTIVATE_PCT = VOLATILE_NORMAL_ACTIVATE_PCT
VOLATILE_SL_TIGHTEN_MULT = VOLATILE_NORMAL_SL_MULT
VOLATILE_TP_STRETCH_MULT = VOLATILE_NORMAL_TP_MULT
SCREENER_TOP_VOLUME_N = int(os.getenv("SCREENER_TOP_VOLUME_N", "100"))  # 상위 100개 (30→100)

# ── DB 경로 ───────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "logger", "trades.db")

# ── 대시보드 설정 ─────────────────────────────────────────
DASHBOARD_PORT = int(os.getenv("DASHBOARD_PORT", "8080"))
DASHBOARD_STATE_PATH = os.path.join(os.path.dirname(__file__), "dashboard", "state.json")
DASHBOARD_PAPER_STATE_PATH = os.path.join(os.path.dirname(__file__), "paper_state.json")

# ── 단타 메타전략 설정 (SCALP) ──────────────────────────────
# S1: RSI 풀백 — 2026-03-15 튜닝 (보조 전략으로 활성화)
# 더 넓은 진입 구간 + 빠른 익절로 승률 개선
SCALP_RSI_PERIOD = 14                          # RSI 계산 기간
SCALP_RSI_PULLBACK_LOW = 20.0                  # 풀백 하한 (30→20, 최대 완화)
SCALP_RSI_PULLBACK_HIGH = 75.0                 # 풀백 상한 (65→75, 거의 모든 RSI 허용)
SCALP_RSI_OVERSOLD = 55.0                      # 과매도 기준 (45→55, 중립 이하 모두 기회)
SCALP_RSI_OVERBOUGHT_EXIT = 68.0               # 과매수 청산 (72→68, 빠른 익절)
SCALP_EMA_SHORT = 15                           # 단기 EMA (20→15, 빠른 반응)
SCALP_EMA_LONG = 50                            # 장기 EMA
SCALP_ATR_PERIOD = 14                          # ATR 기간
SCALP_ATR_SL_MULT = 1.5                        # SL 배수 (넓은 SL=64% 승률 vs tight 20%)
SCALP_ATR_TP_MULT = 2.0                        # TP 배수 (0.8→2.0, RR 최소 1.3 이상 확보 필수)
SCALP_ATR_TRAIL_MULT = 0.8                     # 트레일링 (1.5→0.8, 빠른 이익 보존)
SCALP_VOL_MIN_RATIO = 0.2                      # 거래량 비율 (0.4→0.2, 최대 완화)
SCALP_COOLDOWN_BARS = 1                        # 쿨다운 (2→1, 즉시 재진입)

# S2: 거래량 폭발 — 2026-03-15 튜닝 (더 많은 브레이크아웃 포착)
SCALP_VOL_EXPLOSION_MULT = 0.5                 # 폭발 배수 (0.8→0.5, 약한 거래량도 진입)
SCALP_VOL_MA_PERIOD = 8                        # 거래량 MA (10→8, 빠른 반응)
SCALP_VOL_DRY_RATIO = 0.5                      # 메마름 판정 (0.6→0.5, 더 관대)
SCALP_VOL_BOX_LOOKBACK = 12                    # 박스권 확인 (15→12, 짧은 박스도 포착)
SCALP_VOL_RR_RATIO = 2.0                       # 손익비 (2.5→2.0, TP 적중률↑)

# S3: 하이킨아시 — 2026-03-15 튜닝 (검증된 최고 전략, 진입 빈도↑)
SCALP_HA_DOJI_BODY_RATIO = 0.06                # 도지 판정 (0.05→0.06, 약간 관대해져 진입↑)
SCALP_HA_FLAT_WICK_TOL = 0.003                 # 바닥 허용 (0.002→0.003, 더 많은 반전 포착)
SCALP_HA_RR_RATIO = 2.0                        # 손익비 (1.2→2.0, RR 복원 — 낮은 RR이 -92% 핵심 원인)
SCALP_HA_MIN_BEARISH_CANDLES = 1               # 최소 음봉 (2→1, 빠른 반전도 포착)
SCALP_HA_WEAK_MIN_PCT = 0.8                    # HA_WEAK 최소 이익 (1.0→0.8, 비용커버 유지)
SCALP_HA_MIN_ATR_PCT = 0.2                     # 최소 변동성 (0.3→0.2, 더 많은 기회)

# S4: VWAP — 2026-03-15 튜닝 (VWAP 접근 기회 확대)
SCALP_VWAP_PERIOD = 20                         # VWAP 기간 (24→20, 빠른 앵커)
SCALP_VWAP_BAND_MULT = 1.8                     # 밴드 배수 (2.0→1.8, 밴드 좁혀 진입↑)
SCALP_VWAP_RR_RATIO = 2.0                      # 손익비 (1.3→2.0, 비대칭 수익 구조 복원)
SCALP_VWAP_PULLBACK_TOLERANCE = 0.005          # 근접 허용 (0.003→0.005, 더 관대한 VWAP 접근)

# S5: BEAR 과매도 반등 — 2026-03-15 튜닝 (반등 기회 확대)
SCALP_BEAR_RSI_THRESHOLD = 28.0                # 과매도 RSI (25→28, 더 많은 진입 기회)
SCALP_BEAR_RSI_PERIOD = 14                     # RSI 계산 기간
SCALP_BEAR_BB_PERIOD = 20                      # 볼린저밴드 기간
SCALP_BEAR_BB_STD = 1.8                        # 볼린저밴드 (2.0→1.8, 밴드 좁혀 진입↑)
SCALP_BEAR_VOL_SPIKE = 1.3                     # 투매 클라이맥스 (1.5→1.3, 완화)
SCALP_BEAR_SL_PCT = 2.0                        # 손절 % (1.5→2.0, 노이즈 방어 — NotebookLM)
SCALP_BEAR_TP_PCT = 3.0                        # 익절 (2.5→3.0, 반등 폭 더 수확 — NotebookLM)
SCALP_BEAR_MAX_HOLD_BARS = 8                   # 최대 보유 (10→8, 빠른 청산)
SCALP_BEAR_CONSEC_LOSS_LIMIT = 3               # 연속 손실 쿨다운 발동
SCALP_BEAR_COOLDOWN_BARS = 6                   # 쿨다운 (10→6, 빠른 재진입)
SCALP_BEAR_POSITION_SCALE = 0.5                # 포지션 축소 (유지)

# S6: SMMA 리테스트 — 2026-03-15 튜닝 (현재 유일한 수익 전략, 빈도↑)
SCALP_SMMA_SHORT = 18                          # 단기 SMMA (21→18, 빠른 반응)
SCALP_SMMA_MID = 50                            # 중기 SMMA (유지)
SCALP_SMMA_LONG = 200                          # 장기 SMMA (유지)
SCALP_SMMA_RR_RATIO = 2.0                      # 손익비 (1.3→2.0, PF 1.5+ 확보)
SCALP_SMMA_MAX_HOLD = 15                       # 최대 보유 (20→15, 빠른 회전)
SCALP_SMMA_TANGLE_TOL = 0.007                  # 꼬임 허용 (0.005→0.007, 더 많은 꼬임 감지)
SCALP_SMMA_RETEST_TOL = 0.008                  # 리테스트 허용 (0.005→0.008, 더 관대한 리테스트)

# 공통
SCALP_USE_REGIME_FILTER = True                 # 레짐 필터 사용 여부
SCALP_ENTRY_MODE = "meta"                      # rsi|volume|ha|vwap|meta

# ── 백테스트 정밀도 설정 ──────────────────────────────────
BACKTEST_FEE_PCT = 0.04                        # 빗썸 편도 수수료 % (양방향 합계 0.08%)
BACKTEST_SLIPPAGE_PCT = 0.05                   # 슬리피지 % (5 bps)

# ── 적응형 페이퍼 트레이딩 설정 ─────────────────────────────
PAPER_TRADING_INTERVAL_SEC = 10                # 트레이딩 사이클 주기 (초) — 10초마다 진입 신호 탐색
PAPER_REPORT_INTERVAL_MIN = 60                 # 상태 보고 주기 (분)
PAPER_OHLCV_COUNT = 500                        # 실시간 캔들 수
PAPER_STARTUP_OHLCV_COUNT = 5000               # 시작 시 전체 평가용 캔들 수
PAPER_REEVAL_COOLDOWN_MIN = 0                  # ★ 재평가 쿨다운 제거 (15→0, 즉시 반응)

# ── 전략 진화 엔진 설정 ─────────────────────────────────────
EVOLUTION_CYCLE_MINUTES = 30                   # 최적화 라운드 주기 (분)
EVOLUTION_MIN_IMPROVEMENT_PCT = 5.0            # 최소 개선폭 % (이하면 무시)
EVOLUTION_WALK_FORWARD_RATIO = 0.7             # 학습/검증 시계열 분할 비율
EVOLUTION_MAX_CANDIDATES = 12                  # 라운드당 후보 수
EVOLUTION_MIN_TRADES = 8                       # 후보 최소 거래 수
EVOLUTION_MAX_MDD_PCT = 15.0                   # 후보 최대 허용 MDD %
EVOLUTION_MIN_PF = 1.2                         # 후보 최소 Profit Factor
EVOLUTION_OOS_RATIO = 0.6                      # OOS 점수 ≥ IS 점수 × 이 비율
EVOLUTION_DRIFT_THRESHOLD = 0.3                # 실전 vs 백테스트 괴리 임계값
EVOLUTION_FEEDBACK_LOOKBACK_H = 168            # 피드백 분석 lookback (시간, 1주)

# ── 탐색 슬롯 설정 (자가 진화 실험) ─────────────────────────
# ── 급등 전용 슬롯 설정 ──────────────────────────────────────
SURGE_SLOT_COUNT = 10                              # 급등 전용 슬롯 수
SURGE_SLOT_CAPITAL_RATIO = 0.10                    # 총 자본 중 급등 비율 (10%)

# ── 탐색 슬롯 설정 (자가 진화 실험) ─────────────────────────
EXPLORATION_ENABLED = os.getenv("EXPLORATION_ENABLED", "true").lower() == "true"
EXPLORATION_SLOT_COUNT = 30                    # 탐색 슬롯 수
EXPLORATION_CAPITAL_RATIO = 0.20               # 총 자본 중 탐색 비율 (30→20%, 급등 10% 분리)
EXPLORATION_CAPITAL_SCALE = 0.5                # 슬롯당 배율 유지 (의미 있는 실험 데이터 확보)
EXPLORATION_MIN_TRADES = 20                    # 승격/폐기 판단 최소 거래 수
EXPLORATION_PROMOTE_WR = 50.0                  # 승격 기준 승률 %
EXPLORATION_PROMOTE_PF = 1.3                   # 승격 기준 Profit Factor
EXPLORATION_DISCARD_WR = 35.0                  # 폐기 기준 승률 % (30→35, 빠른 폐기)
EXPLORATION_MAX_LOSS_KRW = 1_000_000           # 변형당 최대 허용 손실 (100만원 초과 시 폐기)
EXPLORATION_EVAL_INTERVAL_MIN = 30             # 평가 주기 (분)
EXPLORATION_MAX_SAME_STRATEGY = 10             # 동일 기본 전략 최대 슬롯 수

# ── 3단계 파이프라인 설정 ─────────────────────────────────
FIXED_SLOTS = ["BTC", "ETH"]                      # ★ 수익 검증된 대형코인 고정 (BTC=S3 +7.85%, ETH=S4 +0.95%)
BENCH_MAX_SIZE = 20                            # 대기석 최대 코인 수
BENCH_MIN_WAIT_HOURS = 0.02                    # ★ 대기석 최소 ~1분 (즉각 승격)
ACTIVE_MIN_STAY_HOURS = 0.083                  # ★ 활성 슬롯 최소 5분 (빠른 교체)
SWAP_SCORE_ADVANTAGE = 1.1                     # ★ 교체 시 10% 우위면 충분 (빠른 순환)

# ── 코인별 캔들 간격 ─────────────────────────────────────
INTERVAL_LARGE_CAP = "30m"                     # 대형 코인 (거래대금 500억+) — 1h→30m 단축
INTERVAL_MID_CAP = "10m"                       # 중형 코인 (50억~500억) — 30m→10m 단축
INTERVAL_SMALL_CAP = "10m"                     # 소형 코인 (50억 미만)
LARGE_CAP_VOLUME_KRW = 50_000_000_000          # 대형 기준 일 거래대금 (500억)
MID_CAP_VOLUME_KRW = 5_000_000_000             # 중형 기준 일 거래대금 (50억)

# ── 스크리닝 대시보드 ─────────────────────────────────────
SCREENING_STATE_PATH = os.path.join(os.path.dirname(__file__), "screening_state.json")

# ── 시장 인텔리전스 설정 ──────────────────────────────────────
INTEL_UPDATE_HOURS = 6                            # 인텔리전스 수집 주기 (시간)
INTEL_DAILY_REPORT_ENABLED = True                 # 일일 리포트 자동 저장

# ── 고급 통계 모듈 설정 ──────────────────────────────────────
# Kelly Criterion
KELLY_MODE = "quarter"                            # "full"→"quarter" (손실 비대칭 방지)
KELLY_MIN_PCT = 5.0                               # 최소 투입 비율 %
KELLY_MAX_PCT = 30.0                              # 최대 투입 30% (50→30, 단일 거래 리스크 제한)
KELLY_MIN_TRADES = 10                             # Kelly 계산에 필요한 최소 거래 수
POSITION_CAP_KRW = 50_000_000                     # 단일 포지션 최대 5천만원 (1억→5천만, GOAT -12.5% 교훈)
POSITION_CAP_EXTREME_KRW = 30_000_000             # EXTREME 코인 최대 3천만원 (변동성 리스크 제한)
COIN_COOLDOWN_MINUTES = 10                        # 같은 코인 재진입 쿨다운 (30→10분, 회전율 개선)

# Monte Carlo
MC_SIMULATIONS = 5000                             # 시뮬레이션 반복 횟수
MC_RUIN_THRESHOLD_PCT = -50.0                     # 파산 판정 기준 %

# GARCH
GARCH_ENABLED = True                              # GARCH 변동성 예측 활성화
GARCH_METHOD = "garch"                            # "garch" 또는 "ewma"
GARCH_LOOKBACK = 200                              # 분석 봉 수

# Bayesian
BAYESIAN_PRIOR_ALPHA = 2.0                        # 사전 분포 alpha (약간 낙관)
BAYESIAN_PRIOR_BETA = 2.0                         # 사전 분포 beta
BAYESIAN_MIN_ADVANTAGE = 0.05                     # 전략 전환 최소 승률 우위 (5%p)
BAYESIAN_MIN_TRADES_SWITCH = 10                   # 전략 전환 판단 최소 거래 수

# HMM
HMM_ENABLED = True                                # HMM 레짐 감지 활성화
HMM_LOOKBACK = 500                                # HMM 학습 봉 수
HMM_REFIT_INTERVAL = 24                           # 모델 재학습 주기 (시간)

# EVT
EVT_MIN_TRADES = 20                               # EVT 분석 최소 거래 수

# ── S7: SMC (Smart Money Concepts) — 2026-03-15 튜닝 ────────
# 이전: 95건/6개월, 20-36% WR → 과다 진입
# 튜닝 방향: 필터 강화로 고품질 진입만 허용, RR 2.5로 현실적 목표
SMC_OB_LOOKBACK = 15                         # OB 탐색 범위 (20→15, 최근 기관 활동에 집중)
SMC_OB_MIN_MOVE_PCT = 2.5                    # OB 후 최소 이동 % (1.5→2.5, 강한 기관 움직임만)
SMC_FVG_MIN_GAP_PCT = 0.6                    # FVG 최소 갭 % (0.3→0.6, 유의미한 갭만)
SMC_LIQUIDITY_SWEEP_PCT = 0.8                # 스윕 범위 % (0.5→0.8, 더 확실한 스윕만)
SMC_RR_RATIO = 2.5                           # 손익비 (3.0→2.5, 현실적 목표로 TP 적중률↑)
SMC_ATR_SL_MULT = 2.0                        # SL 배수 (1.5→2.0, 여유로운 손절 → 노이즈 컷 방지)
SMC_COOLDOWN_BARS = 8                        # 쿨다운 (5→8, 과다 진입 억제)
SMC_MIN_ATR_PCT = 0.2                        # 최소 변동성 (0.3→0.2, 더 많은 기회 허용)

# ── 멀티타임프레임 (MTF) 필터 ──────────────────────────────
MTF_ENABLED = True                            # MTF 필터 활성화
MTF_HIGHER_TF = "4h"                          # 상위 타임프레임 (1h 봇 → 4h 확인)
MTF_TREND_METHOD = "ema"                      # "ema" 또는 "regime"
MTF_EMA_PERIOD = 50                           # 상위 TF EMA 기간
MTF_ALLOW_COUNTER_TREND = True                # ★ 역추세 진입 허용 (0.3x 축소 포지션)
MTF_COUNTER_TREND_SCALE = 0.3                 # ★ 역추세 시 포지션 축소 배율

# ── 일일 최대 손실 한도 ──────────────────────────────────────
DAILY_MAX_LOSS_PCT = 3.0                      # 일일 최대 손실 % (초과 시 당일 거래 중단)
DAILY_MAX_TRADES = 20                         # 일일 최대 거래 수 (과매매 방지)
DAILY_LOSS_RESET_HOUR = 0                     # 일일 손실 리셋 시각 (0시)

# ── VWAP 기관 레벨 강화 ─────────────────────────────────────
VWAP_INSTITUTIONAL_ENABLED = True              # 기관 VWAP 레벨 분석 활성화
VWAP_ANCHOR_PERIODS = [24, 168, 720]           # 앵커 VWAP 기간: 1일, 1주, 1개월
VWAP_CONFLUENCE_TOLERANCE = 0.003              # VWAP 컨플루언스 판정 오차 (0.3%)
VWAP_VOLUME_CONFIRM_MULT = 1.3                # VWAP 레벨 돌파 시 거래량 확인 배수

# ── 실시간 급등 감지 (Surge Detection) ─────────────────────────
SURGE_DETECTION_ENABLED = True                   # 급등 감지 활성화
SURGE_PRICE_1M_PCT = 1.5                         # IGNITION: 1분 내 가격 변화 % 임계값
SURGE_PRICE_5M_PCT = 3.0                         # ACCELERATION: 5분 내 가격 변화 % 임계값
SURGE_VOLUME_MULT = 3.0                          # EWMA 대비 볼륨 배율 임계값
SURGE_CLIMAX_PCT = 10.0                          # 시작 대비 10%+ → CLIMAX (진입 금지)
SURGE_ALERT_COOLDOWN_SEC = 60                    # 같은 코인 알림 간격 (초)
SURGE_MAX_AGE_SEC = 1800                         # 30분 이상 된 급등은 만료
SURGE_CAPITAL_PCT = 1.0                          # 급등 진입 시 총 자본 대비 % (리스크 제한)
SURGE_POOL_PCT = 30.0                            # ★ 총 자본의 30%를 급등락/동적 슬롯에 예약
SURGE_TRAILING_STOP_PCT = 2.0                    # 급등 포지션 트레일링 스탑 %
SURGE_MAX_HOLD_SEC = 1800                        # 급등 포지션 최대 보유 시간 (30분)

# ── 고래 추적 (Whale Tracking) ─────────────────────────────
WHALE_TRACKING_ENABLED = True                  # 고래 추적 활성화
WHALE_ALERT_MIN_BTC = 100                      # 최소 BTC 이동량 (알림 기준)
WHALE_SENTIMENT_WEIGHT = 0.15                  # 인텔 종합점수에서 고래 신호 가중치

# ── Gemini API (유튜브 전략 분석 + 주간 트렌드 학습) ──────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
YOUTUBE_REPORT_DIR = os.path.join(
    os.path.dirname(__file__), ".claude", "memory", "youtube_reports"
)

# ── 주간 트렌드 학습 (Weekly Trend Learner) ───────────────
WEEKLY_LEARNER_ENABLED = True                     # 주간 학습 활성화
WEEKLY_LEARNER_DAY = "monday"                     # 실행 요일
WEEKLY_LEARNER_TIME = "03:00"                     # 실행 시각
WEEKLY_LEARNER_MODEL = "gemini-2.5-flash"  # Gemini 최신 모델
WEEKLY_REPORT_DIR = os.path.join(
    os.path.dirname(__file__), ".claude", "memory", "weekly_reports"
)
# 자동 적용 안전 범위 (이 범위 내에서만 파라미터 자동 조정)
WEEKLY_SL_RANGE = (1.0, 5.0)                      # 손절 % 허용 범위
WEEKLY_TP_RANGE = (1.5, 10.0)                     # 익절 % 허용 범위
WEEKLY_RR_RANGE = (1.5, 5.0)                      # 손익비 허용 범위
WEEKLY_ATR_RANGE = (0.1, 1.0)                     # ATR 필터 허용 범위
