# 적응형 학습 엔진 — 분석 → 규칙 평가 → 게이트 검증 → 적용 → 로그.
"""
이 모듈이 학습 루프의 핵심 조율자(coordinator) 역할을 한다.

사용 흐름:
  1. gridsearch_job() → receive_gridsearch_result()로 최적 파라미터 전달
  2. adaptation_job() → run_adaptation_cycle()로 전체 적응 사이클 실행
  3. run_cycle() → should_block_buy()로 매수 필터 체크
  4. _execute_buy() → get_trade_amount()로 적응형 포지션 크기 반환
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Set, Tuple

import config
from analyzer.analyzer import AnalysisReport, TradeAnalyzer
from backtest.backtest_engine import BacktestEngine
from backtest.data_fetcher import DataFetcher
from learning.adaptation_rules import (
    AdaptationProposal,
    evaluate_all_rules,
)
from learning.learning_log import LearningLog
from logger.trade_logger import TradeLogger
from strategy.rsi_strategy import RSIStrategy
from strategy.strategy_gate import BacktestResult, StrategyGate

logger = logging.getLogger(__name__)


@dataclass
class AdaptiveState:
    """엔진의 런타임 상태 — 현재 적용 중인 필터와 설정."""
    blocked_hours: Set[int] = field(default_factory=set)
    block_downtrend_buy: bool = False
    trade_amount_multiplier: float = 1.0
    last_adaptation_time: Optional[datetime] = None
    adaptation_count: int = 0

    def reset_filters(self) -> None:
        """매 적응 사이클 시작 시 필터를 초기화한다 (재계산용)."""
        self.blocked_hours = set()
        self.block_downtrend_buy = False
        self.trade_amount_multiplier = 1.0


class AdaptiveEngine:
    """
    적응형 학습 엔진.

    TradeAnalyzer 분석 → adaptation_rules 평가 → StrategyGate 검증
    → 적용 → LearningLog 기록의 전체 파이프라인을 조율한다.
    """

    def __init__(
        self,
        strategy: RSIStrategy,
        trade_logger: TradeLogger,
        learning_log: LearningLog,
        gate: StrategyGate,
        client,
        notifier=None,
        coin: str = "BTC",
    ) -> None:
        self.coin = coin
        self.strategy = strategy
        self.trade_logger = trade_logger
        self.learning_log = learning_log
        self.gate = gate
        self.client = client
        self.notifier = notifier

        self._state = AdaptiveState()
        self._pending_best_params: Optional[dict] = None
        self._pending_best_result: Optional[BacktestResult] = None

        logger.info("[AdaptiveEngine] 초기화 완료")

    @property
    def state(self) -> AdaptiveState:
        return self._state

    # ── 외부 인터페이스 ────────────────────────────────────

    def receive_gridsearch_result(
        self, best_params: dict, best_result: BacktestResult
    ) -> None:
        """
        gridsearch_job()에서 호출 — 최적 파라미터를 저장한다.
        다음 adaptation_cycle에서 PARAM_TUNE 규칙이 이를 평가한다.
        """
        self._pending_best_params = best_params
        self._pending_best_result = best_result
        logger.info(
            f"[AdaptiveEngine] 그리드서치 결과 수신: {best_params} "
            f"(승률={best_result.win_rate:.1f}%)"
        )

    def should_block_buy(self, hour: int, trend: str) -> Tuple[bool, str]:
        """
        run_cycle()에서 BUY 신호 시 호출되는 필터.

        Returns:
            (차단 여부, 차단 사유)
        """
        if not config.ADAPTIVE_ENABLED:
            return False, ""

        if hour in self._state.blocked_hours:
            return True, f"시간대 필터: {hour}시는 저성과 시간대"

        if self._state.block_downtrend_buy and trend == "DOWNTREND":
            return True, "추세 필터: 하락 추세 구간 매수 차단"

        return False, ""

    def get_trade_amount(self, base_amount: float) -> float:
        """
        적응형 포지션 크기를 반환한다.

        Args:
            base_amount: config.TRADE_AMOUNT (기본 거래 금액)

        Returns:
            multiplier가 적용된 거래 금액
        """
        if not config.ADAPTIVE_ENABLED:
            return base_amount

        return base_amount * self._state.trade_amount_multiplier

    # ── 적응 사이클 ────────────────────────────────────────

    def run_adaptation_cycle(self) -> List[AdaptationProposal]:
        """
        전체 적응 사이클을 실행한다.

        1. 최근 완료 거래 로드
        2. TradeAnalyzer.analyze()
        3. 4개 규칙 평가 → 제안 목록
        4. 각 제안 검증 + 적용 + 로그
        5. 알림 전송

        Returns:
            처리된 AdaptationProposal 리스트
        """
        if not config.ADAPTIVE_ENABLED:
            logger.info("[AdaptiveEngine] 비활성화 상태 — 스킵")
            return []

        logger.info("[AdaptiveEngine] ═══ 적응 사이클 시작 ═══")

        # 1. 거래 데이터 로드
        trades = self.trade_logger.get_completed_trades()
        if len(trades) < config.ADAPTIVE_MIN_TRADES:
            logger.info(
                f"[AdaptiveEngine] 거래 {len(trades)}건 < "
                f"최소 {config.ADAPTIVE_MIN_TRADES}건 — 스킵"
            )
            return []

        # 2. 분석
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()

        # 3. 필터 초기화 (매 사이클마다 재계산)
        self._state.reset_filters()

        # 4. 규칙 평가
        proposals = evaluate_all_rules(
            report=report,
            current_strategy=self.strategy,
            best_params=self._pending_best_params,
            best_result=self._pending_best_result,
        )

        if not proposals:
            logger.info("[AdaptiveEngine] 적응 제안 없음 — 현재 설정 유지")
            self._state.last_adaptation_time = datetime.now()
            return []

        # 5. 각 제안 처리
        applied_proposals = []
        for proposal in proposals:
            success = self._process_proposal(proposal)
            if success:
                applied_proposals.append(proposal)

        # 6. 상태 업데이트
        self._state.last_adaptation_time = datetime.now()
        self._state.adaptation_count += len(applied_proposals)

        # 7. 그리드서치 결과 소비 (적용 여부와 관계없이 클리어)
        self._pending_best_params = None
        self._pending_best_result = None

        logger.info(
            f"[AdaptiveEngine] ═══ 적응 사이클 완료 ═══ "
            f"제안={len(proposals)} 적용={len(applied_proposals)}"
        )
        logger.info(f"[AdaptiveEngine] 상태: {self.status()}")

        return applied_proposals

    # ── 제안 처리 ──────────────────────────────────────────

    def _process_proposal(self, proposal: AdaptationProposal) -> bool:
        """
        단일 제안을 검증하고 적용한다.

        Returns:
            적용 성공 여부
        """
        coin = self.coin

        # 게이트 검증이 필요한 제안 (PARAM_TUNE)
        if proposal.requires_gate:
            gate_passed, gate_detail = self._validate_with_gate(proposal)
            if not gate_passed:
                self.learning_log.log_adaptation(
                    adaptation_type=proposal.adaptation_type,
                    trigger_reason=proposal.trigger_reason,
                    before_value=proposal.before_value,
                    after_value=proposal.after_value,
                    gate_passed=False,
                    applied=False,
                    coin=coin,
                    gate_detail=gate_detail,
                )
                logger.warning(
                    f"[AdaptiveEngine] {proposal.adaptation_type} 거절 — "
                    f"게이트 미통과: {gate_detail.get('fail_reasons', [])}"
                )
                self._notify_adaptation(proposal, applied=False)
                return False
        else:
            gate_detail = {}

        # 적용
        applied = self._apply_proposal(proposal)

        # 로그
        self.learning_log.log_adaptation(
            adaptation_type=proposal.adaptation_type,
            trigger_reason=proposal.trigger_reason,
            before_value=proposal.before_value,
            after_value=proposal.after_value,
            gate_passed=True,
            applied=applied,
            coin=coin,
            gate_detail=gate_detail,
        )

        if applied:
            logger.info(
                f"[AdaptiveEngine] ✓ {proposal.adaptation_type} 적용 | "
                f"{proposal.trigger_reason}"
            )
        self._notify_adaptation(proposal, applied=applied)
        return applied

    def _validate_with_gate(
        self, proposal: AdaptationProposal
    ) -> Tuple[bool, dict]:
        """
        PARAM_TUNE 제안을 백테스트 + 게이트로 검증한다.

        Returns:
            (통과 여부, 게이트 상세 딕셔너리)
        """
        new_params = proposal.after_value

        try:
            # 새 파라미터로 백테스트
            test_strategy = RSIStrategy(
                period=new_params.get("period", self.strategy.period),
                oversold=new_params.get("oversold", self.strategy.oversold),
                overbought=new_params.get("overbought", self.strategy.overbought),
            )
            fetcher = DataFetcher(self.client)
            df = fetcher.fetch(
                self.coin,
                days=config.BACKTEST_DAYS,
                interval=config.RSI_CANDLE_INTERVAL,
            )
            if df is None or df.empty:
                return False, {"fail_reasons": ["데이터 수집 실패"]}

            engine = BacktestEngine(test_strategy)
            result = engine.run(df)
            gate_result = self.gate.check(result)

            detail = {
                "win_rate": gate_result.win_rate,
                "total_trades": gate_result.total_trades,
                "max_drawdown_pct": gate_result.max_drawdown_pct,
                "profit_factor": gate_result.profit_factor,
                "fail_reasons": gate_result.fail_reasons,
            }
            return gate_result.passed, detail

        except Exception as e:
            logger.error(f"[AdaptiveEngine] 게이트 검증 오류: {e}")
            return False, {"fail_reasons": [f"검증 오류: {e}"]}

    def _apply_proposal(self, proposal: AdaptationProposal) -> bool:
        """제안을 실제로 적용한다."""
        try:
            if proposal.adaptation_type == "PARAM_TUNE":
                return self._apply_param_tune(proposal)
            elif proposal.adaptation_type == "TIME_FILTER":
                return self._apply_time_filter(proposal)
            elif proposal.adaptation_type == "TREND_FILTER":
                return self._apply_trend_filter(proposal)
            elif proposal.adaptation_type == "POSITION_SIZE":
                return self._apply_position_size(proposal)
            else:
                logger.warning(f"알 수 없는 적응 유형: {proposal.adaptation_type}")
                return False
        except Exception as e:
            logger.error(f"[AdaptiveEngine] 적용 오류: {e}")
            return False

    def _apply_param_tune(self, proposal: AdaptationProposal) -> bool:
        """전략 파라미터를 변경한다."""
        new = proposal.after_value
        self.strategy.period = new["period"]
        self.strategy.oversold = new["oversold"]
        self.strategy.overbought = new["overbought"]
        logger.info(
            f"[PARAM_TUNE] 전략 파라미터 변경: "
            f"period={new['period']} oversold={new['oversold']} "
            f"overbought={new['overbought']}"
        )
        return True

    def _apply_time_filter(self, proposal: AdaptationProposal) -> bool:
        """저성과 시간대 차단을 적용한다."""
        hours = proposal.after_value.get("blocked_hours", [])
        self._state.blocked_hours = set(hours)
        logger.info(f"[TIME_FILTER] 차단 시간대: {sorted(self._state.blocked_hours)}")
        return True

    def _apply_trend_filter(self, proposal: AdaptationProposal) -> bool:
        """하락 추세 매수 차단을 적용한다."""
        self._state.block_downtrend_buy = proposal.after_value.get(
            "block_downtrend_buy", False
        )
        logger.info(
            f"[TREND_FILTER] 하락추세 차단: {self._state.block_downtrend_buy}"
        )
        return True

    def _apply_position_size(self, proposal: AdaptationProposal) -> bool:
        """포지션 크기 배율을 변경한다."""
        new_mult = proposal.after_value.get("multiplier", 1.0)
        self._state.trade_amount_multiplier = new_mult
        logger.info(f"[POSITION_SIZE] 포지션 배율: {new_mult:.2f}x")
        return True

    # ── 알림 ───────────────────────────────────────────────

    def _notify_adaptation(
        self, proposal: AdaptationProposal, applied: bool
    ) -> None:
        """텔레그램 알림을 전송한다."""
        if not self.notifier:
            return
        try:
            status = "적용" if applied else "거절"
            self.notifier.send(
                f"<b>적응형 학습 [{status}]</b>\n"
                f"유형: {proposal.adaptation_type}\n"
                f"사유: {proposal.trigger_reason}\n"
                f"변경: {proposal.before_value} → {proposal.after_value}"
            )
        except Exception as e:
            logger.error(f"[AdaptiveEngine] 알림 전송 실패: {e}")

    # ── 상태 조회 ──────────────────────────────────────────

    def status(self) -> dict:
        """현재 적응 상태 요약."""
        return {
            "blocked_hours": sorted(self._state.blocked_hours),
            "block_downtrend_buy": self._state.block_downtrend_buy,
            "trade_amount_multiplier": self._state.trade_amount_multiplier,
            "total_adaptations": self._state.adaptation_count,
            "last_adaptation": (
                self._state.last_adaptation_time.isoformat()
                if self._state.last_adaptation_time
                else None
            ),
            "strategy_params": {
                "period": self.strategy.period,
                "oversold": self.strategy.oversold,
                "overbought": self.strategy.overbought,
            },
            "pending_gridsearch": self._pending_best_params is not None,
        }
