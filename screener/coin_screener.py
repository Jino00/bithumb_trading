"""
코인 스크리너 — 빗썸 전체 코인에서 거래량 + 변동성 기준으로 후보를 선별한다.

선별 기준:
  1차: 일 거래대금 상위 N개 (유동성 확보)
  2차: 일 변동폭(%) 상위 순으로 정렬 (수익 기회)
  3차: 최소 변동폭 이상만 통과 (너무 잠잠한 코인 제외)

사용법:
  python -m screener.coin_screener
"""
import logging
import time
from dataclasses import dataclass
from typing import List, Optional

import pybithumb

import config

logger = logging.getLogger(__name__)


@dataclass
class CoinScore:
    """코인 스크리닝 결과"""
    symbol: str
    close: float              # 현재 종가
    volume_krw: float         # 일 거래대금 (원)
    range_pct: float          # 일 변동폭 % ((고가-저가)/저가*100)
    high: float
    low: float
    volatility_tier: str = "NORMAL"  # NORMAL / HOT / EXTREME


class CoinScreener:
    """
    빗썸 전체 코인을 스캔해서 매매 후보를 추출한다.

    Args:
        min_volume_krw: 최소 일 거래대금 (원). 기본 10억원
        min_range_pct: 최소 일 변동폭 %. 기본 2.0%
        top_volume_n: 거래대금 상위 N개만 후보로. 기본 30
        delay: API 호출 간 대기 (초). 기본 0.05
    """

    def __init__(
        self,
        min_volume_krw: float = 10_0000_0000,   # 10억원
        min_range_pct: float = 2.0,
        top_volume_n: int = 30,
        delay: float = 0.05,
    ) -> None:
        self.min_volume_krw = min_volume_krw
        self.min_range_pct = min_range_pct
        self.top_volume_n = top_volume_n
        self.delay = delay
        # ★ 핫 리스트: 직전 스캔에서 통과한 코인 (빠른 재스캔용)
        self._hot_list: List[str] = []

    def scan(self) -> List[CoinScore]:
        """
        빗썸 전체 코인을 스캔하고 기준에 맞는 코인을 반환한다.

        Returns:
            CoinScore 리스트 (변동폭 내림차순 정렬)
        """
        tickers = pybithumb.get_tickers()
        logger.info(f"빗썸 전체 코인 수: {len(tickers)}")

        # 1단계: 전체 코인 시세 수집
        all_scores: List[CoinScore] = []
        errors = 0
        for ticker in tickers:
            try:
                detail = pybithumb.get_market_detail(ticker)
                if detail is None or detail[3] is None or detail[4] is None:
                    continue
                open_p, high, low, close, vol = detail
                if close <= 0 or vol <= 0 or low <= 0:
                    continue

                volume_krw = close * vol
                range_pct = (high - low) / low * 100

                all_scores.append(CoinScore(
                    symbol=ticker,
                    close=close,
                    volume_krw=volume_krw,
                    range_pct=range_pct,
                    high=high,
                    low=low,
                ))
            except Exception as e:
                errors += 1
                if errors <= 5:
                    logger.debug(f"스캔 실패 [{ticker}]: {e}")

            if self.delay > 0:
                time.sleep(self.delay)

        logger.info(f"시세 수집 완료: {len(all_scores)}개 코인 (실패: {errors})")

        # 1.5단계: 영구 블랙리스트 제외
        perm_bl = getattr(config, "PERMANENT_BLACKLIST", set())
        if perm_bl:
            before = len(all_scores)
            all_scores = [s for s in all_scores if s.symbol not in perm_bl]
            removed = before - len(all_scores)
            if removed > 0:
                logger.info(f"영구 블랙리스트 제외: {removed}개 ({perm_bl})")

        # 2단계: 거래대금 필터
        volume_filtered = [s for s in all_scores if s.volume_krw >= self.min_volume_krw]
        volume_filtered.sort(key=lambda s: s.volume_krw, reverse=True)
        volume_filtered = volume_filtered[:self.top_volume_n]
        logger.info(f"거래대금 필터 통과: {len(volume_filtered)}개 (>= {self.min_volume_krw / 1e8:.0f}억원)")

        # 3단계: 변동폭 필터 + 정렬
        result = [s for s in volume_filtered if s.range_pct >= self.min_range_pct]
        result.sort(key=lambda s: s.range_pct, reverse=True)
        logger.info(f"변동폭 필터 통과: {len(result)}개 (>= {self.min_range_pct}%)")

        # ★ 4단계: 변동성 분류 + 슬리피지 안전 필터
        # 급등락 코인은 차단하지 않고, 변동성 티어로 분류하여 실시간 대응한다.
        # 단, 가격이 너무 낮아 슬리피지가 과다한 코인만 제외한다.
        min_price = config.SCREENER_MIN_PRICE_KRW
        hot_range_pct = config.SCREENER_HOT_RANGE_PCT
        extreme_range_pct = config.SCREENER_EXTREME_RANGE_PCT

        safe_result = []
        filtered_out = []
        for s in result:
            # 가격이 너무 낮으면 슬리피지 과다 (1원 = 수십% 변동) → 유일한 차단 조건
            if s.close < min_price:
                filtered_out.append(f"{s.symbol}(가격 {s.close:.0f}원<{min_price}원)")
                continue

            # ★ 변동성 티어 분류 (차단 아님!)
            if s.range_pct >= extreme_range_pct:
                s.volatility_tier = "EXTREME"
            elif s.range_pct >= hot_range_pct:
                s.volatility_tier = "HOT"
            else:
                s.volatility_tier = "NORMAL"

            safe_result.append(s)

        if filtered_out:
            logger.info(f"슬리피지 필터 제외: {', '.join(filtered_out)}")

        hot_coins = [s for s in safe_result if s.volatility_tier != "NORMAL"]
        if hot_coins:
            logger.info(
                f"급등락 코인 감지 (실시간 대응 대상): "
                f"{', '.join(f'{s.symbol}({s.volatility_tier} {s.range_pct:.0f}%)' for s in hot_coins)}"
            )
        result = safe_result

        # ★ 핫 리스트 갱신 (다음 quick_scan에서 사용)
        self._hot_list = [s.symbol for s in result]

        return result

    def quick_scan(self) -> List[CoinScore]:
        """★ 핫 리스트 코인만 빠르게 재스캔한다.

        직전 full scan에서 통과한 코인 + 활성 슬롯 코인만 조회하므로
        452개 전체(~40초) 대신 30~50개만(~3초) 조회한다.

        Returns:
            CoinScore 리스트 (변동폭 내림차순 정렬)
        """
        if not self._hot_list:
            logger.info("핫 리스트 비어있음 → full scan 실행")
            return self.scan()

        result: List[CoinScore] = []
        for symbol in self._hot_list:
            score = self.scan_single(symbol)
            if score and score.volume_krw >= self.min_volume_krw:
                result.append(score)

        result.sort(key=lambda s: s.range_pct, reverse=True)
        logger.info(f"퀵 스캔 완료: {len(result)}/{len(self._hot_list)}개 "
                     f"(핫 리스트 재스캔)")
        return result

    def scan_single(self, symbol: str) -> Optional[CoinScore]:
        """단일 코인의 CoinScore를 조회한다 (고래 추적 등에서 사용)."""
        try:
            detail = pybithumb.get_market_detail(symbol)
            if detail is None or detail[3] is None or detail[4] is None:
                return None
            open_p, high, low, close, vol = detail
            if close <= 0 or vol <= 0 or low <= 0:
                return None
            volume_krw = close * vol
            range_pct = (high - low) / low * 100
            return CoinScore(
                symbol=symbol,
                close=close,
                volume_krw=volume_krw,
                range_pct=range_pct,
                high=high,
                low=low,
            )
        except Exception as e:
            logger.debug(f"단일 스캔 실패 [{symbol}]: {e}")
            return None

    def report(self, scores: Optional[List[CoinScore]] = None) -> str:
        """스크리닝 결과를 가독성 있게 출력한다."""
        if scores is None:
            scores = self.scan()

        if not scores:
            return "스크리닝 결과: 조건을 충족하는 코인이 없습니다."

        lines = [
            "=" * 65,
            "  코인 스크리닝 결과 (거래대금 + 변동폭 기준)",
            "=" * 65,
            f"  {'순위':>4} | {'코인':>6} | {'종가':>14} | {'거래대금(억)':>10} | {'변동폭':>8}",
            "-" * 65,
        ]
        for i, s in enumerate(scores, 1):
            lines.append(
                f"  {i:>4} | {s.symbol:>6} | {s.close:>14,.0f} | "
                f"{s.volume_krw / 1e8:>10,.1f} | {s.range_pct:>7.2f}%"
            )
        lines.append("=" * 65)
        return "\n".join(lines)


# ── 직접 실행 ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import logging as _logging
    _logging.basicConfig(level=_logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    screener = CoinScreener(
        min_volume_krw=10_0000_0000,  # 10억원
        min_range_pct=2.0,
        top_volume_n=30,
    )
    results = screener.scan()
    print(screener.report(results))

    if results:
        print(f"\n  추천 코인: {results[0].symbol} (변동폭 {results[0].range_pct:.2f}%, 거래대금 {results[0].volume_krw/1e8:.0f}억)")
