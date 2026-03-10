"""StrategyEvaluator 단위 테스트."""
import numpy as np
import pandas as pd
import pytest

from monitor.strategy_evaluator import (
    StrategyEvaluator,
    StrategyScore,
    EvaluationResult,
    robust_score,
    _get_default_params,
    _RUNNERS,
)


class TestRobustScore:
    """robust_score() 스코어링 함수 테스트."""

    def test_insufficient_trades_returns_minus_one(self):
        stats = {"count": 2, "win_rate": 80, "pf": 2.0, "mdd": 5, "total_return": 10, "avg_pnl": 1.0}
        assert robust_score(stats, min_trades=5) == -1

    def test_positive_return_weighted_higher(self):
        base = {"count": 20, "win_rate": 55, "pf": 1.5, "mdd": 5, "avg_pnl": 0.5}
        stats_pos = {**base, "total_return": 10.0}
        stats_neg = {**base, "total_return": -10.0}
        assert robust_score(stats_pos) > robust_score(stats_neg)

    def test_high_trade_count_bonus(self):
        base = {"win_rate": 55, "pf": 1.5, "mdd": 5, "total_return": 5.0, "avg_pnl": 0.5}
        stats_20 = {**base, "count": 20}
        stats_7 = {**base, "count": 7}
        score_20 = robust_score(stats_20)
        score_7 = robust_score(stats_7)
        assert score_20 > score_7  # 20건 → 1.1x, 7건 → 0.7x

    def test_zero_avg_pnl_no_bonus(self):
        stats = {"count": 10, "win_rate": 50, "pf": 1.0, "mdd": 10, "total_return": 0, "avg_pnl": 0}
        score = robust_score(stats)
        assert isinstance(score, float)

    def test_high_mdd_penalized(self):
        base = {"count": 20, "win_rate": 55, "pf": 1.5, "total_return": 5.0, "avg_pnl": 0.5}
        stats_low_mdd = {**base, "mdd": 2}
        stats_high_mdd = {**base, "mdd": 25}
        assert robust_score(stats_low_mdd) > robust_score(stats_high_mdd)

    def test_pf_capped_at_5(self):
        base = {"count": 20, "win_rate": 55, "mdd": 5, "total_return": 5.0, "avg_pnl": 0.5}
        stats_pf5 = {**base, "pf": 5.0}
        stats_pf100 = {**base, "pf": 100.0}
        # PF가 5로 캡되므로 점수가 같아야 함
        assert robust_score(stats_pf5) == robust_score(stats_pf100)


class TestGetDefaultParams:
    """_get_default_params() 테스트."""

    def test_s1_params(self):
        params = _get_default_params("S1")
        assert "rsi_low" in params
        assert "rsi_high" in params
        assert "sl_mult" in params
        assert "tp_mult" in params

    def test_s2_params(self):
        params = _get_default_params("S2")
        assert "explosion_mult" in params
        assert "box_lookback" in params

    def test_s3_params(self):
        params = _get_default_params("S3")
        assert "doji_body_ratio" in params
        assert "ha_weak_min_pct" in params
        assert "min_atr_pct" in params

    def test_s4_params(self):
        params = _get_default_params("S4")
        assert "vwap_period" in params

    def test_s5_params(self):
        params = _get_default_params("S5")
        assert "rsi_threshold" in params
        assert "bb_period" in params

    def test_s6_params(self):
        params = _get_default_params("S6")
        assert "smma_short" in params
        assert "smma_long" in params

    def test_unknown_strategy_empty(self):
        params = _get_default_params("S99")
        assert params == {}


class TestRunnersMapping:
    """_RUNNERS 전략 매핑 테스트."""

    def test_all_six_strategies_registered(self):
        assert len(_RUNNERS) == 6

    def test_runner_entries_have_name_and_fn(self):
        for sid, (name, fn) in _RUNNERS.items():
            assert isinstance(name, str)
            assert callable(fn)

    def test_expected_strategy_ids(self):
        assert set(_RUNNERS.keys()) == {"S1", "S2", "S3", "S4", "S5", "S6"}


class TestStrategyScore:
    """StrategyScore 데이터클래스 테스트."""

    def test_creation(self):
        sc = StrategyScore(
            name="Test", strategy_id="S1",
            score=42.0, stats={"count": 10}, params={},
            trades_count=10,
        )
        assert sc.name == "Test"
        assert sc.score == 42.0
        assert sc.trades_count == 10


class TestEvaluationResult:
    """EvaluationResult 데이터클래스 테스트."""

    def test_defaults(self):
        r = EvaluationResult()
        assert r.scores == []
        assert r.best is None
        assert r.current_regime == ""
        assert r.evaluation_candles == 0


class TestStrategyEvaluatorInit:
    """StrategyEvaluator 초기화 테스트."""

    def test_default_params(self):
        e = StrategyEvaluator()
        assert e._min_trades == 5

    def test_custom_params(self):
        e = StrategyEvaluator(fee_pct=0.1, slippage_pct=0.2, min_trades=10)
        assert e._fee_pct == 0.1
        assert e._slippage_pct == 0.2
        assert e._min_trades == 10


class TestStrategyEvaluatorRunStrategy:
    """_run_strategy() 단위 테스트 (최소 데이터로 실행)."""

    def _make_minimal_df(self, n: int = 300) -> tuple:
        """전략 실행에 필요한 최소 DataFrame + regimes."""
        np.random.seed(42)
        base = 80_000_000
        close = base + np.cumsum(np.random.randn(n) * base * 0.005)
        close = np.maximum(close, base * 0.8)
        df = pd.DataFrame({
            "open": close * (1 + np.random.randn(n) * 0.002),
            "high": close * (1 + abs(np.random.randn(n) * 0.005)),
            "low": close * (1 - abs(np.random.randn(n) * 0.005)),
            "close": close,
            "volume": np.random.uniform(50, 200, n),
        })
        from backtest_scalp import compute_indicators, compute_regime
        df = compute_indicators(df)
        regimes = compute_regime(df)
        return df, regimes

    def test_run_strategy_returns_score(self):
        df, regimes = self._make_minimal_df()
        e = StrategyEvaluator()
        sc = e._run_strategy("S3", df, regimes)
        assert isinstance(sc, StrategyScore)
        assert sc.strategy_id == "S3"
        assert sc.name == "S3_HeikinAshi"

    def test_run_strategy_bad_id_raises(self):
        df, regimes = self._make_minimal_df()
        e = StrategyEvaluator()
        with pytest.raises(KeyError):
            e._run_strategy("S99", df, regimes)


class TestStrategyEvaluatorEvaluate:
    """evaluate_all / quick_eval 통합 테스트."""

    def _make_df(self, n: int = 500) -> tuple:
        np.random.seed(123)
        base = 80_000_000
        close = base + np.cumsum(np.random.randn(n) * base * 0.005)
        close = np.maximum(close, base * 0.8)
        df = pd.DataFrame({
            "open": close * (1 + np.random.randn(n) * 0.002),
            "high": close * (1 + abs(np.random.randn(n) * 0.005)),
            "low": close * (1 - abs(np.random.randn(n) * 0.005)),
            "close": close,
            "volume": np.random.uniform(50, 200, n),
        })
        from backtest_scalp import compute_indicators, compute_regime
        df = compute_indicators(df)
        regimes = compute_regime(df)
        return df, regimes

    def test_evaluate_all_returns_6_scores(self):
        df, regimes = self._make_df()
        e = StrategyEvaluator()
        result = e.evaluate_all(df, regimes)
        assert isinstance(result, EvaluationResult)
        assert len(result.scores) == 6
        assert result.evaluation_candles == len(df)

    def test_evaluate_all_scores_sorted_descending(self):
        df, regimes = self._make_df()
        e = StrategyEvaluator()
        result = e.evaluate_all(df, regimes)
        scores = [s.score for s in result.scores]
        assert scores == sorted(scores, reverse=True)

    def test_quick_eval_uses_tail(self):
        df, regimes = self._make_df(n=800)
        e = StrategyEvaluator()
        result = e.quick_eval(df, regimes, tail=300)
        assert result.evaluation_candles <= 300

    def test_quick_eval_small_df_no_trim(self):
        df, regimes = self._make_df(n=200)
        e = StrategyEvaluator()
        result = e.quick_eval(df, regimes, tail=500)
        assert result.evaluation_candles == len(df)

    def test_print_evaluation_table_runs(self, capsys):
        df, regimes = self._make_df()
        e = StrategyEvaluator()
        result = e.evaluate_all(df, regimes)
        # 단순히 예외 없이 실행되는지 확인
        StrategyEvaluator.print_evaluation_table(result)
        captured = capsys.readouterr()
        assert "전략 평가 결과" in captured.out
