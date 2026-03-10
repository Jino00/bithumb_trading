#!/usr/bin/env python3
# 전략 진화 엔진 CLI — 6전략 파라미터를 지속적으로 최적화하는 독립 프로세스.
"""
사용법:
  python run_evolution.py --coins BTC,ETH,XRP --verbose
  python run_evolution.py --once                    # 1라운드만 실행
  python run_evolution.py --interval 15 --verbose   # 15분 주기
"""
import argparse
import logging
import signal
import sys

import config
from evolution.evolution_engine import EvolutionOrchestrator

# ── 로깅 설정 ───────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── 전역 인스턴스 (시그널 핸들러용) ─────────────────────
_engine: EvolutionOrchestrator | None = None


def _signal_handler(signum, _frame):
    """SIGINT/SIGTERM 시 그레이스풀 종료."""
    sig_name = signal.Signals(signum).name
    print(f"\n[{sig_name}] 진화 엔진 종료 중...")
    if _engine:
        _engine.shutdown()
    sys.exit(0)


def parse_args() -> argparse.Namespace:
    """커맨드라인 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="전략 진화 엔진 — 6전략 파라미터 자동 최적화"
    )
    parser.add_argument(
        "--coins", type=str, default="BTC",
        help="최적화 대상 코인 (쉼표 구분, 기본: BTC)",
    )
    parser.add_argument(
        "--interval", type=int,
        default=config.EVOLUTION_CYCLE_MINUTES,
        help=f"최적화 주기 (분, 기본: {config.EVOLUTION_CYCLE_MINUTES})",
    )
    parser.add_argument(
        "--candidates", type=int,
        default=config.EVOLUTION_MAX_CANDIDATES,
        help=f"라운드당 후보 수 (기본: {config.EVOLUTION_MAX_CANDIDATES})",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="1라운드만 실행하고 종료",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="상세 로그 출력",
    )
    return parser.parse_args()


def main() -> None:
    """메인 진입점."""
    global _engine

    args = parse_args()
    coins = [c.strip().upper() for c in args.coins.split(",")]

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # 시그널 핸들러 등록
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    # 엔진 생성 + 시작
    _engine = EvolutionOrchestrator(
        coins=coins,
        cycle_minutes=args.interval,
        max_candidates=args.candidates,
        verbose=args.verbose,
    )
    _engine.startup()

    if args.once:
        # 1라운드만 실행
        result = _engine.run_once()
        print(f"\n[결과] {result}")
        _engine.shutdown()
    else:
        # 무한 루프
        try:
            _engine.run_forever()
        except KeyboardInterrupt:
            pass
        finally:
            _engine.shutdown()


if __name__ == "__main__":
    main()
