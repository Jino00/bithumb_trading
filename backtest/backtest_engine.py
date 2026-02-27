"""
백테스트 엔진

기능:
  run()         — 단일 파라미터로 1년 백테스트 실행
  grid_search() — RSI 파라미터 그리드서치로 최적 조합 탐색
"""
import itertools
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

import config
from strategy.base_strategy import BaseStrategy
from strategy.rsi_strategy import RSIStrategy
from strategy.strategy_gate import BacktestResult

logger = logging.getLogger(__name__)


# ── 그리드서치 결과 ────────────────────────────────────────────────────────────

@dataclass
class GridSearchResult:
    best_params: dict
    best_result: BacktestResult
    all_results: List[Tuple[dict, BacktestResult]]  # (params, result) 전체 목록


# ── 백테스트 엔진 ──────────────────────────────────────────────────────────────

class BacktestEngine:
    """
    단순 롱온리 포지션 시뮬레이터.

    진입: BUY 신호 && 포지션 없음
    청산: SELL 신호 || 손절 || 익절 || 마지막 캔들 강제 청산

    Note:
        슬리피지와 수수료는 포함하지 않는다.
        실전 성과는 백테스트보다 낮을 수 있음.
    """

    def __init__(
        self,
        strategy: BaseStrategy,
        stop_loss_pct: Optional[float] = None,
        take_profit_pct: Optional[float] = None,
    ) -> None:
        self.strategy = strategy
        self.stop_loss_pct = stop_loss_pct if stop_loss_pct is not None else config.STOP_LOSS_PCT
        self.take_profit_pct = take_profit_pct if take_profit_pct is not None else config.TAKE_PROFIT_PCT

    # ── 단일 백테스트 ──────────────────────────────────────

    def run(self, df: pd.DataFrame) -> BacktestResult:
        """
        1년 OHLCV 데이터로 전략을 시뮬레이션한다.

        전략이 precompute_signals()를 지원하면 O(n) 고속 경로를 사용.
        지원하지 않으면 캔들마다 generate_signal()을 호출하는 일반 경로 사용.

        Args:
            df: OHLCV DataFrame (index=datetime, 컬럼명 소문자)

        Returns:
            BacktestResult
        """
        if df is None or len(df) < config.RSI_PERIOD + 10:
            logger.warning("데이터 부족 — 빈 결과 반환")
            return BacktestResult(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0)

        logger.debug(
            f"백테스트 시작 — 전략={self.strategy.name} | "
            f"캔들={len(df)} | SL={self.stop_loss_pct}% | TP={self.take_profit_pct}%"
        )

        # ── O(n) 고속 경로: 전체 신호 사전 계산 ──────────
        if hasattr(self.strategy, "precompute_signals"):
            return self._run_fast(df)

        # ── 일반 경로 ─────────────────────────────────────
        return self._run_slow(df)

    def _run_fast(self, df: pd.DataFrame) -> BacktestResult:
        """O(n) — precompute_signals()로 전체 신호를 먼저 계산 후 순회"""
        signals = self.strategy.precompute_signals(df)  # type: ignore[attr-defined]
        close_arr = df["close"].astype(float).values
        signal_arr = signals.values

        trade_pairs: List[Tuple[float, float]] = []
        entry_price: float = 0.0
        in_position: bool = False

        for i in range(len(df)):
            price = close_arr[i]
            sig = signal_arr[i]

            if in_position:
                pnl = (price - entry_price) / entry_price * 100
                if pnl <= -self.stop_loss_pct or pnl >= self.take_profit_pct:
                    trade_pairs.append((entry_price, price))
                    in_position = False
                    continue
                if sig == "SELL":
                    trade_pairs.append((entry_price, price))
                    in_position = False
            else:
                if sig == "BUY":
                    entry_price = price
                    in_position = True

        if in_position:
            trade_pairs.append((entry_price, close_arr[-1]))

        return self._calc_result(trade_pairs)

    def _run_slow(self, df: pd.DataFrame) -> BacktestResult:
        """O(n²) 일반 경로 — 캔들마다 generate_signal() 호출"""
        trade_pairs: List[Tuple[float, float]] = []
        entry_price: float = 0.0
        in_position: bool = False
        close_arr = df["close"].astype(float).values
        warmup = config.RSI_PERIOD + 5

        for i in range(warmup, len(df)):
            window = df.iloc[: i + 1]
            price = close_arr[i]

            if in_position:
                pnl = (price - entry_price) / entry_price * 100
                if pnl <= -self.stop_loss_pct:
                    trade_pairs.append((entry_price, price))
                    in_position = False
                    continue
                if pnl >= self.take_profit_pct:
                    trade_pairs.append((entry_price, price))
                    in_position = False
                    continue
                if self.strategy.generate_signal(window) == "SELL":
                    trade_pairs.append((entry_price, price))
                    in_position = False
            else:
                if self.strategy.generate_signal(window) == "BUY":
                    entry_price = price
                    in_position = True

        if in_position and len(close_arr) > 0:
            trade_pairs.append((entry_price, close_arr[-1]))

        return self._calc_result(trade_pairs)

    # ── 그리드서치 ─────────────────────────────────────────

    def grid_search(
        self,
        df: pd.DataFrame,
        param_grid: Optional[Dict[str, List[Any]]] = None,
        min_trades: int = 100,
    ) -> GridSearchResult:
        """
        RSI 파라미터 조합을 완전 탐색해 BacktestResult 기준 최적 파라미터를 찾는다.

        Args:
            df: OHLCV DataFrame
            param_grid: 탐색할 파라미터 딕셔너리.
                기본값: {
                    'period':     [7, 10, 14, 21],
                    'oversold':   [20, 25, 30],
                    'overbought': [65, 70, 75, 80],
                }

        Returns:
            GridSearchResult (best_params, best_result, all_results)
        """
        if param_grid is None:
            param_grid = {
                "period":     [7, 10, 14, 21],
                "oversold":   [20, 25, 30],
                "overbought": [65, 70, 75, 80],
            }

        keys = list(param_grid.keys())
        combinations = list(itertools.product(*[param_grid[k] for k in keys]))
        total = len(combinations)
        logger.info(f"그리드서치 시작: {total}개 파라미터 조합")

        all_results: List[Tuple[dict, BacktestResult]] = []
        best_params: dict = {}
        best_result: Optional[BacktestResult] = None

        for idx, combo in enumerate(combinations, 1):
            params = dict(zip(keys, combo))

            # oversold >= overbought 조합은 스킵
            if params.get("oversold", 0) >= params.get("overbought", 100):
                continue

            strategy = RSIStrategy(
                period=params.get("period", 14),
                oversold=params.get("oversold", 30),
                overbought=params.get("overbought", 70),
            )
            engine = BacktestEngine(
                strategy,
                stop_loss_pct=self.stop_loss_pct,
                take_profit_pct=self.take_profit_pct,
            )
            result = engine.run(df)
            result.best_params = params
            all_results.append((params, result))

            if best_result is None or self._is_better(result, best_result, min_trades):
                best_result = result
                best_params = params

            if idx % 10 == 0 or idx == total:
                logger.debug(f"  그리드서치 진행: {idx}/{total}")

        # 정렬: 승률 내림차순, 동점 시 PF 내림차순
        all_results.sort(key=lambda x: (x[1].win_rate, x[1].profit_factor), reverse=True)

        # 유효 조합이 전혀 없는 경우 빈 결과 반환
        if best_result is None:
            logger.warning("그리드서치: 유효한 파라미터 조합 없음")
            empty = BacktestResult(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0)
            return GridSearchResult(
                best_params={},
                best_result=empty,
                all_results=[],
            )

        logger.info(
            f"그리드서치 완료 ({len(all_results)}개 조합) | "
            f"최적 파라미터={best_params} | "
            f"승률={best_result.win_rate:.1f}% | PF={best_result.profit_factor:.2f}"
        )

        return GridSearchResult(
            best_params=best_params,
            best_result=best_result,
            all_results=all_results,
        )

    def top_results(self, gs: GridSearchResult, n: int = 5) -> str:
        """그리드서치 상위 N개 결과를 가독성 있게 출력"""
        lines = [f"[ 그리드서치 상위 {n}개 결과 ]"]
        for i, (params, r) in enumerate(gs.all_results[:n], 1):
            lines.append(
                f"  {i}. params={params} | "
                f"승률={r.win_rate:.1f}% | "
                f"거래={r.total_trades} | "
                f"PF={r.profit_factor:.2f} | "
                f"MDD={r.max_drawdown_pct:.1f}%"
            )
        return "\n".join(lines)

    # ── 내부 헬퍼 ──────────────────────────────────────────

    def _calc_result(self, pairs: List[Tuple[float, float]]) -> BacktestResult:
        """(entry, exit) 쌍 목록으로 BacktestResult 계산"""
        if not pairs:
            return BacktestResult(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0)

        pnl_list: List[float] = []
        equity = 1.0
        peak = 1.0
        max_dd = 0.0

        for entry, exit_ in pairs:
            pnl_pct = (exit_ - entry) / entry * 100
            pnl_list.append(pnl_pct)
            equity *= 1 + pnl_pct / 100
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak * 100
            if dd > max_dd:
                max_dd = dd

        total = len(pnl_list)
        wins = sum(1 for p in pnl_list if p > 0)
        losses = total - wins
        win_rate = wins / total * 100 if total else 0.0
        total_return = (equity - 1.0) * 100
        avg_profit = sum(pnl_list) / total if total else 0.0

        # Profit Factor
        gross_profit = sum(p for p in pnl_list if p > 0)
        gross_loss = abs(sum(p for p in pnl_list if p < 0))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        profit_factor = min(profit_factor, config.PROFIT_FACTOR_MAX_CAP)  # inf 방지

        result = BacktestResult(
            total_trades=total,
            winning_trades=wins,
            losing_trades=losses,
            win_rate=round(win_rate, 2),
            total_return_pct=round(total_return, 2),
            max_drawdown_pct=round(max_dd, 2),
            avg_profit_pct=round(avg_profit, 4),
            profit_factor=round(float(profit_factor), 3),
        )

        logger.debug(
            f"백테스트 완료 | 거래={total} | 승={wins} | 패={losses} | "
            f"승률={win_rate:.1f}% | 수익={total_return:.2f}% | "
            f"MDD={max_dd:.2f}% | PF={result.profit_factor:.2f}"
        )
        return result

    @staticmethod
    def _is_better(new: BacktestResult, current: BacktestResult, min_trades: int = 100) -> bool:
        """
        새 결과가 현재 최선보다 나은지 비교.

        우선순위:
          1. min_trades 충족 결과 우선 (충족 vs 미충족)
          2. 동일 조건이면 승률 높은 쪽
          3. 승률 동점이면 PF 높은 쪽
        """
        new_ok = new.total_trades >= min_trades
        cur_ok = current.total_trades >= min_trades

        if new_ok and not cur_ok:
            return True   # 새 결과만 최소 거래 수 충족
        if not new_ok and cur_ok:
            return False  # 현재 결과만 최소 거래 수 충족

        # 둘 다 같은 조건 → 승률, 동점 시 PF
        if new.win_rate != current.win_rate:
            return new.win_rate > current.win_rate
        return new.profit_factor > current.profit_factor


# ── 직접 실행 (빠른 백테스트 확인) ───────────────────────────────────────────

if __name__ == "__main__":
    import logging as _logging
    _logging.basicConfig(
        level=_logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    from exchange.bithumb_client import BithumbClient
    from strategy.strategy_gate import StrategyGate
    from backtest.data_fetcher import DataFetcher

    _client = BithumbClient("", "")
    _fetcher = DataFetcher(_client)
    _df = _fetcher.fetch(config.TRADE_COIN, days=config.BACKTEST_DAYS)

    if _df is not None:
        _strategy = RSIStrategy(config.RSI_PERIOD, config.RSI_OVERSOLD, config.RSI_OVERBOUGHT)
        _engine = BacktestEngine(_strategy)

        print("\n=== 단일 백테스트 ===")
        _result = _engine.run(_df)
        _gate = StrategyGate(config.MIN_WIN_RATE)
        print(_gate.summary(_result))

        print("\n=== 그리드서치 ===")
        _gs = _engine.grid_search(_df)
        print(_engine.top_results(_gs, n=5))
        print(f"\n최적 파라미터: {_gs.best_params}")
        print(_gate.summary(_gs.best_result))
