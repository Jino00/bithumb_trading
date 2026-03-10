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

            # 슬롯별 실시간 거래 정보
            slots_extra: dict[str, Any] = {}
            for coin, slot in portfolio._slots.items():
                bot = slot.bot
                extra = _build_slot_extra(bot, slot)
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
                    bot.coin: _build_slot_extra_single(bot),
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


# ── 슬롯 데이터 빌더 ──────────────────────────────────────────────────────────


def _build_slot_extra(bot, slot) -> dict[str, Any]:
    """멀티코인 모드: 슬롯의 실시간 거래 정보를 구성한다."""
    entry_price = getattr(bot, "_entry_price", None)
    entry_time = getattr(bot, "_entry_time", None)
    has_position = bot._current_entry_id is not None

    # 현재가 & 미실현 P&L
    current_price = getattr(bot, "_last_price", None)
    unrealized_pnl = None
    if has_position and entry_price and current_price:
        unrealized_pnl = round(
            (current_price - entry_price) / entry_price * 100, 2
        )

    # 적응형 SL/TP
    sl_pct = config.STOP_LOSS_PCT
    tp_pct = config.TAKE_PROFIT_PCT
    if getattr(slot, "adaptive_engine", None):
        sl_pct = slot.adaptive_engine.get_stop_loss_pct()
        tp_pct = slot.adaptive_engine.get_take_profit_pct()

    # 진입 사유 (DB에서 로드됨)
    entry_reason = getattr(bot, "_entry_reason", None)
    rsi_at_entry = getattr(bot, "_entry_rsi", None)

    return {
        "entry_id": bot._current_entry_id,
        "entry_price": entry_price,
        "entry_time": entry_time.isoformat() if entry_time else None,
        "current_price": current_price,
        "unrealized_pnl": unrealized_pnl,
        "entry_reason": entry_reason,
        "rsi_at_entry": rsi_at_entry,
        "stop_loss_pct": round(sl_pct, 2),
        "take_profit_pct": round(tp_pct, 2),
    }


def _build_slot_extra_single(bot) -> dict[str, Any]:
    """단일코인 모드: 봇의 실시간 거래 정보를 구성한다."""
    entry_price = getattr(bot, "_entry_price", None)
    entry_time = getattr(bot, "_entry_time", None)
    has_position = bot._current_entry_id is not None

    current_price = getattr(bot, "_last_price", None)
    unrealized_pnl = None
    if has_position and entry_price and current_price:
        unrealized_pnl = round(
            (current_price - entry_price) / entry_price * 100, 2
        )

    sl_pct = config.STOP_LOSS_PCT
    tp_pct = config.TAKE_PROFIT_PCT
    if getattr(bot, "adaptive_engine", None):
        sl_pct = bot.adaptive_engine.get_stop_loss_pct()
        tp_pct = bot.adaptive_engine.get_take_profit_pct()

    entry_reason = getattr(bot, "_entry_reason", None)
    rsi_at_entry = getattr(bot, "_entry_rsi", None)

    return {
        "entry_id": bot._current_entry_id,
        "entry_price": entry_price,
        "entry_time": entry_time.isoformat() if entry_time else None,
        "current_price": current_price,
        "unrealized_pnl": unrealized_pnl,
        "entry_reason": entry_reason,
        "rsi_at_entry": rsi_at_entry,
        "stop_loss_pct": round(sl_pct, 2),
        "take_profit_pct": round(tp_pct, 2),
    }


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────


def _atomic_write(data: dict, path: str = STATE_PATH) -> None:
    """임시 파일에 쓴 뒤 rename으로 원자적 교체."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(Path(path).parent), suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, default=str)
        os.replace(tmp_path, path)
    except Exception:
        # 실패 시 임시 파일 정리
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


PAPER_STATE_PATH = config.DASHBOARD_PAPER_STATE_PATH


class PaperStateWriter:
    """페이퍼 트레이더 상태를 paper_state.json에 기록한다."""

    @staticmethod
    def update(trader) -> None:
        """AdaptivePaperTrader 상태를 JSON으로 직렬화 후 원자적 기록."""
        try:
            state = _build_paper_state(trader)
            _atomic_write(state, PAPER_STATE_PATH)
        except Exception as e:
            logger.error(f"PaperState 기록 실패: {e}")

    @staticmethod
    def update_portfolio(manager) -> None:
        """PaperPortfolioManager 상태를 paper_state.json에 기록한다."""
        try:
            state = _build_paper_portfolio_state(manager)
            _atomic_write(state, PAPER_STATE_PATH)
        except Exception as e:
            logger.error(f"PaperPortfolioState 기록 실패: {e}")


class PaperStateReader:
    """FastAPI 서버가 호출 — paper_state.json에서 페이퍼 트레이딩 상태를 읽는다."""

    def __init__(self, cache_ttl: float = 1.0) -> None:
        self._cache: Optional[dict] = None
        self._cache_time: float = 0.0
        self._cache_ttl = cache_ttl

    def read(self) -> Optional[dict]:
        """캐시된 상태를 반환한다. TTL 만료 시 디스크에서 다시 읽는다."""
        now = time.monotonic()
        if self._cache and (now - self._cache_time) < self._cache_ttl:
            return self._cache

        try:
            if not Path(PAPER_STATE_PATH).exists():
                return None

            with open(PAPER_STATE_PATH, encoding="utf-8") as f:
                data = json.load(f)

            self._cache = data
            self._cache_time = now
            return data
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"PaperState 읽기 실패 (캐시 사용): {e}")
            return self._cache


def _build_paper_state(trader) -> dict:
    """AdaptivePaperTrader → 대시보드용 JSON dict 변환."""
    # KPI
    wins = sum(1 for t in trader._trades if t.pnl_pct > 0)
    total = len(trader._trades)
    win_rate = wins / total * 100 if total > 0 else 0

    total_value = trader._balance_krw
    if trader._position:
        # 포지션 가치 추정 (진입가 기준)
        total_value += trader._position.quantity * trader._position.entry_price

    total_return_pct = (
        (total_value - trader._initial_capital)
        / trader._initial_capital * 100
        if trader._initial_capital > 0 else 0
    )

    kpi = {
        "balance": round(trader._balance_krw, 0),
        "total_value": round(total_value, 0),
        "initial_capital": round(trader._initial_capital, 0),
        "total_return_pct": round(total_return_pct, 2),
        "total_trades": total,
        "win_rate": round(win_rate, 1),
        "active_strategy_id": trader._active_strategy_id,
        "active_strategy_name": trader._active_strategy_name,
        "regime": trader._monitor.current_regime,
        "coin": trader._coin,
        "cycle_count": trader._cycle_count,
    }

    # 포지션
    position = None
    if trader._position:
        pos = trader._position
        position = {
            "coin": pos.coin,
            "entry_price": round(pos.entry_price, 0),
            "quantity": pos.quantity,
            "entry_time": pos.entry_time,
            "sl_pct": pos.sl_pct,
            "tp_pct": pos.tp_pct,
            "strategy": pos.strategy,
            "invested_krw": round(pos.invested_krw, 0),
        }

    # 6전략 평가 점수
    eval_scores = []
    if trader._last_eval and trader._last_eval.scores:
        for sc in trader._last_eval.scores:
            eval_scores.append({
                "strategy_id": sc.strategy_id,
                "name": sc.name,
                "score": round(sc.score, 1),
                "trades_count": sc.trades_count,
                "win_rate": round(sc.stats.get("win_rate", 0), 1),
                "pf": round(sc.stats.get("pf", 0), 2),
                "total_return": round(sc.stats.get("total_return", 0), 2),
                "is_active": sc.strategy_id == trader._active_strategy_id,
            })

    # 트리거 이력 (최근 50건)
    triggers = []
    for t in trader._monitor.trigger_history[-50:]:
        triggers.append({
            "timestamp": getattr(t, "timestamp", ""),
            "trigger_type": t.trigger_type.value,
            "severity": t.severity,
            "description": t.description,
            "old_value": t.old_value,
            "new_value": t.new_value,
        })

    # 거래 이력 (최근 100건)
    trades = []
    for t in trader._trades[-100:]:
        trades.append({
            "entry_time": t.entry_time,
            "exit_time": t.exit_time,
            "strategy": t.strategy,
            "entry_price": round(t.entry_price, 0),
            "exit_price": round(t.exit_price, 0),
            "quantity": t.quantity,
            "pnl_krw": round(t.pnl_krw, 0),
            "pnl_pct": round(t.pnl_pct, 2),
            "exit_reason": t.exit_reason,
            "invested_krw": round(t.invested_krw, 0),
        })

    # 자본 곡선 (누적 잔고 기록)
    equity_curve = []
    running = trader._initial_capital
    for t in trader._trades:
        running += t.pnl_krw
        equity_curve.append({
            "timestamp": t.exit_time,
            "balance": round(running, 0),
        })

    return {
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "kpi": kpi,
        "position": position,
        "eval_scores": eval_scores,
        "triggers": triggers,
        "trades": trades,
        "equity_curve": equity_curve,
    }


def _build_paper_portfolio_state(manager) -> dict:
    """PaperPortfolioManager → 대시보드용 JSON dict 변환 (멀티코인)."""
    total_value = manager.portfolio_total_value()
    all_trades = manager.all_trades()
    total_trades = len(all_trades)
    wins = sum(1 for t in all_trades if t.pnl_krw > 0)
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0
    total_return_pct = (
        (total_value - manager._initial_capital)
        / manager._initial_capital * 100
        if manager._initial_capital > 0 else 0
    )

    # 포트폴리오 수준 KPI
    portfolio_kpi = {
        "total_value": round(total_value, 0),
        "initial_capital": round(manager._initial_capital, 0),
        "unallocated_krw": round(manager._unallocated_krw, 0),
        "total_return_pct": round(total_return_pct, 2),
        "total_trades": total_trades,
        "win_rate": round(win_rate, 1),
        "active_coins": [c for c, s in manager._slots.items() if not s.draining],
        "max_positions": manager._max_positions,
        "scan_count": manager._scan_count,
        "blacklist": list(manager._blacklist.keys()),
    }

    # 합산 KPI (하위 호환)
    kpi = {
        "balance": round(total_value - sum(
            s.trader._position.quantity * s.trader._position.entry_price
            for s in manager._slots.values() if s.trader._position
        ), 0),
        "total_value": round(total_value, 0),
        "initial_capital": round(manager._initial_capital, 0),
        "total_return_pct": round(total_return_pct, 2),
        "total_trades": total_trades,
        "win_rate": round(win_rate, 1),
        "active_strategy_id": "",
        "active_strategy_name": "PORTFOLIO",
        "regime": "MIXED",
        "coin": "MULTI",
        "cycle_count": manager._cycle_count,
    }

    # 각 코인 슬롯 정보
    positions = []
    for coin, slot in manager._slots.items():
        t = slot.trader
        t_wins = sum(1 for tr in t._trades if tr.pnl_krw > 0)
        t_total = len(t._trades)
        t_wr = (t_wins / t_total * 100) if t_total > 0 else 0
        t_val = t._balance_krw
        if t._position:
            t_val += t._position.quantity * t._position.entry_price
        t_ret = ((t_val / slot.allocated_krw) - 1) * 100 if slot.allocated_krw > 0 else 0

        pos_info = None
        if t._position:
            pos = t._position
            pos_info = {
                "coin": pos.coin,
                "entry_price": round(pos.entry_price, 0),
                "quantity": pos.quantity,
                "entry_time": pos.entry_time,
                "sl_pct": pos.sl_pct,
                "tp_pct": pos.tp_pct,
                "strategy": pos.strategy,
                "invested_krw": round(pos.invested_krw, 0),
            }

        positions.append({
            "coin": coin,
            "allocated_krw": round(slot.allocated_krw, 0),
            "balance_krw": round(t._balance_krw, 0),
            "active_strategy_id": t._active_strategy_id,
            "active_strategy_name": t._active_strategy_name,
            "regime": t._monitor.current_regime,
            "cycle_count": t._cycle_count,
            "total_trades": t_total,
            "win_rate": round(t_wr, 1),
            "total_return_pct": round(t_ret, 2),
            "position": pos_info,
            "draining": slot.draining,
            "activated_at": slot.activated_at.isoformat(timespec="seconds"),
        })

    # 전체 거래 이력 (최근 200건)
    trades = []
    for t in all_trades[-200:]:
        trades.append({
            "entry_time": t.entry_time,
            "exit_time": t.exit_time,
            "strategy": t.strategy,
            "entry_price": round(t.entry_price, 0),
            "exit_price": round(t.exit_price, 0),
            "quantity": t.quantity,
            "pnl_krw": round(t.pnl_krw, 0),
            "pnl_pct": round(t.pnl_pct, 2),
            "exit_reason": t.exit_reason,
            "invested_krw": round(t.invested_krw, 0),
            "coin": t.coin,
        })

    # 전체 트리거 (최근 100건)
    triggers = []
    for slot in manager._slots.values():
        for tr in slot.trader._monitor.trigger_history[-20:]:
            triggers.append({
                "timestamp": getattr(tr, "timestamp", ""),
                "trigger_type": tr.trigger_type.value,
                "severity": tr.severity,
                "description": f"[{slot.coin}] {tr.description}",
                "old_value": tr.old_value,
                "new_value": tr.new_value,
            })
    triggers = triggers[-100:]

    # 자본 곡선 (합산)
    equity_curve = []
    running = manager._initial_capital
    for t in all_trades:
        running += t.pnl_krw
        equity_curve.append({
            "timestamp": t.exit_time,
            "balance": round(running, 0),
        })

    return {
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "mode": "MULTI",
        "kpi": kpi,
        "portfolio_kpi": portfolio_kpi,
        "position": None,
        "positions": positions,
        "eval_scores": [],
        "triggers": triggers,
        "trades": trades,
        "equity_curve": equity_curve,
    }


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
