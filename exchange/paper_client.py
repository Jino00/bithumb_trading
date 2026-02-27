"""
페이퍼 트레이딩 클라이언트 — 실제 주문 없이 가상 매매를 시뮬레이션한다.

실시세(현재가, OHLCV, 호가창)는 진짜 빗썸 API에서 가져오고,
매수/매도/잔고는 메모리에서 시뮬레이션한다.
"""
import logging
from typing import Optional

import pandas as pd

from exchange.bithumb_client import BithumbClient

logger = logging.getLogger(__name__)


class PaperClient:
    """
    BithumbClient와 동일한 인터페이스를 제공하되,
    주문(buy/sell)은 가상으로 처리한다.

    Args:
        real_client: 시세 조회용 BithumbClient 인스턴스
        initial_krw: 초기 가상 원화 잔고 (기본 1,000,000원)
    """

    def __init__(self, real_client: BithumbClient, initial_krw: float = 1_000_000) -> None:
        self._real = real_client
        self._krw: float = initial_krw
        self._coins: dict[str, float] = {}  # coin -> quantity
        self._trade_count: int = 0
        logger.info(f"[PAPER] 페이퍼 트레이딩 모드 | 초기 잔고: {initial_krw:,.0f}원")

    # ── 시세 조회 (진짜 API 위임) ────────────────────────────

    def get_current_price(self, coin: str) -> Optional[float]:
        return self._real.get_current_price(coin)

    def get_ohlcv(self, coin: str, interval: str = "1h", count: int = 200) -> Optional[pd.DataFrame]:
        return self._real.get_ohlcv(coin, interval=interval, count=count)

    def get_historical_ohlcv(self, coin: str, interval: str = "24h") -> Optional[pd.DataFrame]:
        return self._real.get_historical_ohlcv(coin, interval=interval)

    def get_orderbook(self, coin: str) -> Optional[dict]:
        return self._real.get_orderbook(coin)

    # ── 잔고 조회 (가상) ────────────────────────────────────

    def get_krw_balance(self) -> Optional[float]:
        return self._krw

    def get_coin_balance(self, coin: str) -> Optional[float]:
        return self._coins.get(coin, 0.0)

    def get_balance_summary(self, coin: str) -> dict:
        coin_qty = self._coins.get(coin, 0.0)
        current = self.get_current_price(coin) or 0.0
        return {
            "krw": self._krw,
            "coin": coin_qty,
            "coin_krw_value": coin_qty * current,
            "total_krw": self._krw + coin_qty * current,
        }

    # ── 주문 (가상 시뮬레이션) ──────────────────────────────

    def buy(self, coin: str, amount: float) -> dict:
        """
        가상 시장가 매수.

        Args:
            coin: 코인 심볼
            amount: 매수 수량 (코인 단위)

        Returns:
            가상 API 응답 dict
        """
        price = self.get_current_price(coin)
        if price is None:
            raise RuntimeError(f"[PAPER] 현재가 조회 실패 — 매수 불가 [{coin}]")

        cost = price * amount
        if cost > self._krw:
            raise RuntimeError(
                f"[PAPER] 잔고 부족: 필요 {cost:,.0f}원 > 보유 {self._krw:,.0f}원"
            )

        self._krw -= cost
        self._coins[coin] = self._coins.get(coin, 0.0) + amount
        self._trade_count += 1

        logger.info(
            f"[PAPER] 매수 완료 [{coin}] amount={amount:.8f} "
            f"price={price:,.0f} cost={cost:,.0f} | 잔고={self._krw:,.0f}원"
        )
        return {"status": "paper", "order_id": f"PAPER-BUY-{self._trade_count}"}

    def sell(self, coin: str, amount: float) -> dict:
        """
        가상 시장가 매도.

        Args:
            coin: 코인 심볼
            amount: 매도 수량 (코인 단위)

        Returns:
            가상 API 응답 dict
        """
        price = self.get_current_price(coin)
        if price is None:
            raise RuntimeError(f"[PAPER] 현재가 조회 실패 — 매도 불가 [{coin}]")

        held = self._coins.get(coin, 0.0)
        if amount > held:
            raise RuntimeError(
                f"[PAPER] 코인 잔고 부족 [{coin}]: 요청 {amount:.8f} > 보유 {held:.8f}"
            )

        revenue = price * amount
        self._coins[coin] = held - amount
        self._krw += revenue
        self._trade_count += 1

        logger.info(
            f"[PAPER] 매도 완료 [{coin}] amount={amount:.8f} "
            f"price={price:,.0f} revenue={revenue:,.0f} | 잔고={self._krw:,.0f}원"
        )
        return {"status": "paper", "order_id": f"PAPER-SELL-{self._trade_count}"}

    @property
    def trade_count(self) -> int:
        return self._trade_count
