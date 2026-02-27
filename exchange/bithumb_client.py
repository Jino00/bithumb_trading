"""
빗썸 API 클라이언트 래퍼 (pybithumb 기반)

기능:
  - 현재가 조회
  - OHLCV 캔들 조회 (실시간 / 1년치 백테스트용)
  - 매수/매도 시장가 주문
  - 원화 / 코인 잔고 조회
  - 호가창 조회 (스프레드 분석용)
"""
import logging
import time
from functools import wraps
from typing import Optional

import pandas as pd
import pybithumb

import config

logger = logging.getLogger(__name__)

# pybithumb chart_intervals → 빗썸 API 파라미터 매핑
_VALID_INTERVALS = {"1m", "3m", "5m", "10m", "30m", "1h", "6h", "12h", "24h"}


def _retry(max_attempts: int = 3, delay: float = 1.0):
    """네트워크 오류 시 최대 max_attempts 회 재시도하는 데코레이터"""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except Exception as e:
                    last_exc = e
                    if attempt < max_attempts:
                        logger.warning(f"{fn.__name__} 실패 ({attempt}/{max_attempts}): {e} — 재시도")
                        time.sleep(delay * attempt)
            logger.error(f"{fn.__name__} 최종 실패: {last_exc}")
            raise last_exc
        return wrapper
    return decorator


class BithumbClient:
    def __init__(self, api_key: str, secret_key: str) -> None:
        self.api_key = api_key
        self.secret_key = secret_key
        self._bithumb: Optional[pybithumb.Bithumb] = None

        if api_key and secret_key:
            try:
                self._bithumb = pybithumb.Bithumb(api_key, secret_key)
                logger.info("빗썸 인증 클라이언트 초기화 완료")
            except Exception as e:
                logger.warning(f"빗썸 인증 초기화 실패 (공개 API만 사용): {e}")
        else:
            logger.info("API 키 없음 — 공개 API 전용 모드")

    # ── 시세 조회 ──────────────────────────────────────────

    @_retry(max_attempts=3, delay=1.0)
    def get_current_price(self, coin: str) -> Optional[float]:
        """현재가 조회 (KRW 마켓)"""
        price = pybithumb.get_current_price(coin)
        if price is None:
            raise ValueError(f"현재가 None 반환 [{coin}]")
        return float(price)

    @_retry(max_attempts=3, delay=1.5)
    def get_ohlcv(
        self,
        coin: str,
        interval: str = "1h",
        count: int = 200,
    ) -> Optional[pd.DataFrame]:
        """
        실시간 OHLCV 캔들 조회 (전략 신호 생성용).

        Args:
            coin: 코인 심볼 (예: 'BTC')
            interval: 캔들 단위 ('1m','3m','5m','10m','30m','1h','6h','12h','24h')
            count: 반환 캔들 수 (최대 API 제공 범위 내)

        Returns:
            DataFrame(open, high, low, close, volume) | None
        """
        if interval not in _VALID_INTERVALS:
            raise ValueError(f"지원하지 않는 interval: {interval}")

        df = pybithumb.get_candlestick(coin, chart_intervals=interval)
        if df is None or df.empty:
            raise ValueError("OHLCV 응답 없음")

        df = df.tail(count).copy()
        df.columns = [c.lower() for c in df.columns]
        df = df.rename(columns={"value": "volume"}) if "value" in df.columns else df

        # 숫자형 변환
        for col in ["open", "high", "low", "close", "volume"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df.dropna(subset=["close"], inplace=True)
        return df

    @_retry(max_attempts=3, delay=1.5)
    def get_historical_ohlcv(
        self,
        coin: str,
        interval: str = "24h",
    ) -> Optional[pd.DataFrame]:
        """
        과거 OHLCV 전체 조회 (백테스트용).
        pybithumb은 단일 호출로 제공 가능한 최대 범위를 반환한다.
        1년 백테스트에는 '24h' 캔들 사용 권장 (365개로 충분).

        Returns:
            DataFrame(open, high, low, close, volume) | None
        """
        if interval not in _VALID_INTERVALS:
            raise ValueError(f"지원하지 않는 interval: {interval}")

        df = pybithumb.get_candlestick(coin, chart_intervals=interval)
        if df is None or df.empty:
            raise ValueError("과거 OHLCV 응답 없음")

        df = df.copy()
        df.columns = [c.lower() for c in df.columns]
        df = df.rename(columns={"value": "volume"}) if "value" in df.columns else df

        for col in ["open", "high", "low", "close", "volume"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df.dropna(subset=["close"], inplace=True)
        logger.info(f"과거 OHLCV 수집 완료 [{coin}/{interval}]: {len(df)}개 캔들")
        return df

    # ── 호가창 조회 ────────────────────────────────────────

    def get_orderbook(self, coin: str) -> Optional[dict]:
        """호가창 조회 — 스프레드 및 매수/매도 압력 분석용"""
        try:
            ob = pybithumb.get_orderbook(coin)
            if ob is None:
                return None

            bids = ob.get("bids", [])
            asks = ob.get("asks", [])

            if not bids or not asks:
                return None

            best_bid = float(bids[0]["price"])
            best_ask = float(asks[0]["price"])
            spread_pct = (best_ask - best_bid) / best_bid * 100

            # 상위 N레벨 호가량 합산
            n = config.ORDERBOOK_LEVELS
            bid_qty = sum(float(b["quantity"]) for b in bids[:n])
            ask_qty = sum(float(a["quantity"]) for a in asks[:n])

            return {
                "best_bid": best_bid,
                "best_ask": best_ask,
                "spread_pct": round(spread_pct, 4),
                "bid_qty": bid_qty,
                "ask_qty": ask_qty,
                "bid_ask_ratio": round(bid_qty / ask_qty, 3) if ask_qty else 0,
            }
        except Exception as e:
            logger.error(f"호가창 조회 실패 [{coin}]: {e}")
            return None

    # ── 잔고 조회 ──────────────────────────────────────────

    def get_krw_balance(self) -> Optional[float]:
        """가용 원화 잔고"""
        if self._bithumb is None:
            logger.warning("인증 클라이언트 없음 — 잔고 조회 불가")
            return None
        try:
            balance = self._bithumb.get_balance("BTC")
            # pybithumb: [avail_coin, locked_coin, avail_krw, locked_krw, ...]
            return float(balance[2])
        except Exception as e:
            logger.error(f"원화 잔고 조회 실패: {e}")
            return None

    def get_coin_balance(self, coin: str) -> Optional[float]:
        """가용 코인 잔고"""
        if self._bithumb is None:
            return None
        try:
            balance = self._bithumb.get_balance(coin)
            return float(balance[0])
        except Exception as e:
            logger.error(f"코인 잔고 조회 실패 [{coin}]: {e}")
            return None

    def get_balance_summary(self, coin: str) -> dict:
        """원화 + 코인 잔고 요약"""
        krw = self.get_krw_balance() or 0.0
        coin_qty = self.get_coin_balance(coin) or 0.0
        current = self.get_current_price(coin) or 0.0
        return {
            "krw": krw,
            "coin": coin_qty,
            "coin_krw_value": coin_qty * current,
            "total_krw": krw + coin_qty * current,
        }

    # ── 주문 ───────────────────────────────────────────────

    @_retry(max_attempts=2, delay=0.5)
    def buy(self, coin: str, amount: float) -> dict:
        """
        시장가 매수.

        Args:
            coin: 코인 심볼
            amount: 매수 수량 (코인 단위)

        Returns:
            API 응답 dict
        """
        if self._bithumb is None:
            raise RuntimeError("인증 클라이언트 미초기화 — API 키를 .env에 설정하세요")

        result = self._bithumb.buy_market_order(coin, amount)
        logger.info(f"매수 완료 [{coin}] amount={amount:.8f}")
        return result or {}

    @_retry(max_attempts=2, delay=0.5)
    def sell(self, coin: str, amount: float) -> dict:
        """
        시장가 매도.

        Args:
            coin: 코인 심볼
            amount: 매도 수량 (코인 단위)

        Returns:
            API 응답 dict
        """
        if self._bithumb is None:
            raise RuntimeError("인증 클라이언트 미초기화 — API 키를 .env에 설정하세요")

        result = self._bithumb.sell_market_order(coin, amount)
        logger.info(f"매도 완료 [{coin}] amount={amount:.8f}")
        return result or {}
