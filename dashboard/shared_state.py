# 봇 ↔ 대시보드 공유 상태 — JSON 파일을 통한 프로세스 간 통신.
"""
SharedStateWriter: 트레이딩 봇 프로세스가 매 사이클마다 런타임 상태를 JSON으로 기록.
SharedStateReader: FastAPI 서버가 JSON 파일을 읽어 API/WebSocket으로 제공.

통신 방식:
  - atomic write (임시 파일 + os.rename)로 partial read 방지
  - Reader는 1초 캐시로 디스크 I/O 최소화
"""
import json
import logging
import os
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import config

logger = logging.getLogger(__name__)

STATE_PATH = config.DASHBOARD_STATE_PATH


class SharedStateWriter:
    """트레이딩 봇이 호출 — 런타임 상태를 JSON 파일에 기록한다."""

    @staticmethod
    def update_from_portfolio(portfolio) -> None:
        """PortfolioManager 상태를 JSON으로 덤프한다."""
        try:
            status = portfolio.status()

            # 슬롯별 추가 정보 (entry_id, entry_price, entry_time)
            slots_extra: dict[str, Any] = {}
            for coin, slot in portfolio._slots.items():
                bot = slot.bot
                extra: dict[str, Any] = {
                    "entry_id": bot._current_entry_id,
                    "entry_price": getattr(bot, "_entry_price", None),
                    "entry_time": (
                        bot._entry_time.isoformat()
                        if getattr(bot, "_entry_time", None)
                        else None
                    ),
                }
                slots_extra[coin] = extra

            state = {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "bot_active": True,
                "mode": "MULTI",
                "portfolio": status,
                "slots_extra": slots_extra,
                "config": _snapshot_config(),
            }

            _atomic_write(state)
        except Exception as e:
            logger.error(f"SharedState 기록 실패: {e}")

    @staticmethod
    def update_from_single_bot(bot) -> None:
        """단일 코인 봇 상태를 JSON으로 덤프한다."""
        try:
            state = {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "bot_active": bot.is_active,
                "mode": "SINGLE",
                "portfolio": {
                    "active_coins": [bot.coin] if bot.is_active else [],
                    "total_slots": 1,
                    "draining_count": 0,
                    "blacklist": [],
                    "portfolio_equity": 1.0,
                    "portfolio_mdd_pct": 0.0,
                    "total_trades": 0,
                    "slots": {
                        bot.coin: {
                            "draining": False,
                            "active": bot.is_active,
                            "has_position": bot._current_entry_id is not None,
                            "strategy": str(bot.strategy),
                            "live_win_rate": bot.live_monitor.current_win_rate(),
                            "risk_dd": bot.risk_manager.status()["current_drawdown_pct"],
                            "activated_at": datetime.now().isoformat(),
                        },
                    },
                },
                "slots_extra": {
                    bot.coin: {
                        "entry_id": bot._current_entry_id,
                        "entry_price": getattr(bot, "_entry_price", None),
                        "entry_time": (
                            bot._entry_time.isoformat()
                            if getattr(bot, "_entry_time", None)
                            else None
                        ),
                    },
                },
                "config": _snapshot_config(),
            }

            _atomic_write(state)
        except Exception as e:
            logger.error(f"SharedState 기록 실패: {e}")


class SharedStateReader:
    """FastAPI 서버가 호출 — JSON 파일에서 봇 상태를 읽는다."""

    def __init__(self, cache_ttl: float = 1.0) -> None:
        self._cache: Optional[dict] = None
        self._cache_time: float = 0.0
        self._cache_ttl = cache_ttl

    def read(self) -> dict:
        """캐시된 상태를 반환한다. TTL 만료 시 디스크에서 다시 읽는다."""
        now = time.monotonic()
        if self._cache and (now - self._cache_time) < self._cache_ttl:
            return self._cache

        try:
            if not Path(STATE_PATH).exists():
                return self._empty_state()

            with open(STATE_PATH, encoding="utf-8") as f:
                data = json.load(f)

            self._cache = data
            self._cache_time = now
            return data
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"SharedState 읽기 실패 (캐시 사용): {e}")
            return self._cache or self._empty_state()

    @staticmethod
    def _empty_state() -> dict:
        return {
            "timestamp": None,
            "bot_active": False,
            "mode": "UNKNOWN",
            "portfolio": {
                "active_coins": [],
                "total_slots": 0,
                "draining_count": 0,
                "blacklist": [],
                "portfolio_equity": 1.0,
                "portfolio_mdd_pct": 0.0,
                "total_trades": 0,
                "slots": {},
            },
            "slots_extra": {},
            "config": {},
        }


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────


def _atomic_write(data: dict) -> None:
    """임시 파일에 쓴 뒤 rename으로 원자적 교체."""
    Path(STATE_PATH).parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(Path(STATE_PATH).parent), suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, default=str)
        os.replace(tmp_path, STATE_PATH)
    except Exception:
        # 실패 시 임시 파일 정리
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def _snapshot_config() -> dict:
    """대시보드 표시용 설정 스냅샷."""
    return {
        "trade_coin": config.TRADE_COIN,
        "trade_amount": config.TRADE_AMOUNT,
        "stop_loss_pct": config.STOP_LOSS_PCT,
        "take_profit_pct": config.TAKE_PROFIT_PCT,
        "max_drawdown_pct": config.MAX_DRAWDOWN_PCT,
        "rsi_period": config.RSI_PERIOD,
        "rsi_oversold": config.RSI_OVERSOLD,
        "rsi_overbought": config.RSI_OVERBOUGHT,
        "rsi_candle_interval": config.RSI_CANDLE_INTERVAL,
        "adx_period": config.ADX_PERIOD,
        "adx_trend_threshold": config.ADX_TREND_THRESHOLD,
        "adx_range_threshold": config.ADX_RANGE_THRESHOLD,
        "grid_count": config.GRID_COUNT,
        "grid_range_period": config.GRID_RANGE_PERIOD,
        "min_win_rate": config.MIN_WIN_RATE,
        "min_backtest_trades": config.MIN_BACKTEST_TRADES,
        "min_profit_factor": config.MIN_PROFIT_FACTOR,
        "live_win_rate_threshold": config.LIVE_WIN_RATE_THRESHOLD,
        "max_positions": config.MAX_POSITIONS,
        "portfolio_mdd_pct": config.PORTFOLIO_MDD_PCT,
        "adaptive_enabled": config.ADAPTIVE_ENABLED,
        "paper_trading": config.PAPER_TRADING,
    }
