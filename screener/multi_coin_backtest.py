# 멀티 코인 백테스트 — 스크리너 후보 코인별 그리드서치 + 게이트 검증
"""
스크리너에서 뽑은 후보 코인들에 대해
RSI 그리드서치를 돌려 게이트 통과 여부를 확인한다.

사용법:
  python -m screener.multi_coin_backtest
"""
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from exchange.bithumb_client import BithumbClient
from backtest.data_fetcher import DataFetcher
from backtest.backtest_engine import BacktestEngine
from strategy.rsi_strategy import RSIStrategy
from strategy.macd_strategy import MACDStrategy
from strategy.bollinger_strategy import BollingerStrategy
from strategy.strategy_gate import StrategyGate

logger = logging.getLogger(__name__)


# ── 후보 코인 목록 (스크리너 결과에서 변동폭 적절한 코인 선정) ─────────────
CANDIDATE_COINS = [
    # 변동폭 10~20% + 유동성 OK
    "ENSO", "VIRTUAL", "GWEI", "DOT", "BARD", "ESP",
    # 변동폭 15~35% + 유동성 OK
    "GRND", "ORBS", "STABLE", "GPS",
    # 대형 유동성 코인 (변동폭 3~5%이지만 참조용)
    "XRP", "ETH", "SOL", "DOGE",
]

# 전략 목록
STRATEGIES = {
    "RSI": lambda: RSIStrategy(),
    "MACD": lambda: MACDStrategy(),
    "Bollinger": lambda: BollingerStrategy(),
}


def run_multi_coin_backtest():
    """후보 코인별 3개 전략 백테스트 + 게이트 검증"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    client = BithumbClient("", "")
    fetcher = DataFetcher(client)
    gate = StrategyGate(
        min_win_rate=config.MIN_WIN_RATE,
        min_trades=config.MIN_BACKTEST_TRADES,
        max_mdd=config.MAX_DRAWDOWN_PCT,
        min_profit_factor=config.MIN_PROFIT_FACTOR,
    )

    results_table = []

    for coin in CANDIDATE_COINS:
        logger.info(f"\n{'='*60}")
        logger.info(f"  코인: {coin} 백테스트 시작")
        logger.info(f"{'='*60}")

        # 데이터 수집 (1h 캔들, 365일)
        df = fetcher.fetch(coin, days=365, interval="1h")
        if df is None or len(df) < 100:
            logger.warning(f"  [{coin}] 데이터 부족 — 스킵")
            results_table.append({
                "coin": coin, "strategy": "-", "win_rate": 0,
                "trades": 0, "mdd": 0, "pf": 0, "return": 0,
                "gate": "DATA_FAIL",
            })
            continue

        candle_count = len(df)

        for strat_name, strat_factory in STRATEGIES.items():
            strategy = strat_factory()
            engine = BacktestEngine(strategy)

            if strat_name == "RSI":
                # RSI는 그리드서치로 최적 파라미터 탐색
                gs = engine.grid_search(df, min_trades=50)
                result = gs.best_result
                params_str = str(gs.best_params)
            else:
                # MACD, Bollinger는 기본 파라미터로 단일 백테스트
                result = engine.run(df)
                params_str = "default"

            gate_result = gate.check(result)
            status = "PASS" if gate_result.passed else "FAIL"

            results_table.append({
                "coin": coin,
                "strategy": strat_name,
                "win_rate": result.win_rate,
                "trades": result.total_trades,
                "mdd": result.max_drawdown_pct,
                "pf": result.profit_factor,
                "return": result.total_return_pct,
                "gate": status,
                "params": params_str,
                "candles": candle_count,
            })

            logger.info(
                f"  [{coin}/{strat_name}] 승률={result.win_rate:.1f}% "
                f"거래={result.total_trades} MDD={result.max_drawdown_pct:.1f}% "
                f"PF={result.profit_factor:.2f} 수익={result.total_return_pct:.1f}% "
                f"→ {status}"
            )

    # ── 최종 리포트 출력 ────────────────────────────────────
    print("\n")
    print("=" * 90)
    print("  멀티 코인 백테스트 결과 (스크리너 후보 × 3전략)")
    print("=" * 90)
    print(f"  {'코인':>8} | {'전략':>10} | {'승률':>6} | {'거래':>5} | {'MDD':>6} | {'PF':>6} | {'수익':>8} | {'게이트':>6}")
    print("-" * 90)

    passed_list = []
    for r in results_table:
        gate_mark = "✓" if r["gate"] == "PASS" else "✗"
        print(
            f"  {r['coin']:>8} | {r['strategy']:>10} | "
            f"{r['win_rate']:>5.1f}% | {r['trades']:>5} | "
            f"{r['mdd']:>5.1f}% | {r['pf']:>5.2f} | "
            f"{r['return']:>7.1f}% | {gate_mark} {r['gate']}"
        )
        if r["gate"] == "PASS":
            passed_list.append(r)

    print("=" * 90)

    if passed_list:
        print(f"\n  게이트 통과 코인/전략 조합: {len(passed_list)}개")
        for p in passed_list:
            print(f"    → {p['coin']}/{p['strategy']} (승률 {p['win_rate']:.1f}%, PF {p['pf']:.2f})")
    else:
        print("\n  게이트 통과한 조합이 없습니다.")
        # 가장 근접한 결과 3개 출력
        near = [r for r in results_table if r["gate"] != "DATA_FAIL"]
        near.sort(key=lambda x: (x["win_rate"], x["pf"]), reverse=True)
        print("  가장 근접한 상위 3개:")
        for p in near[:3]:
            print(
                f"    → {p['coin']}/{p['strategy']} "
                f"(승률 {p['win_rate']:.1f}%, 거래 {p['trades']}, "
                f"MDD {p['mdd']:.1f}%, PF {p['pf']:.2f})"
            )

    return results_table


if __name__ == "__main__":
    run_multi_coin_backtest()
