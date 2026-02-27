# exchange/ — 빗썸 API 클라이언트

## 파일 구조
- `bithumb_client.py`: pybithumb 기반 API 래퍼 (시세, 주문, 잔고, 호가)

## 규칙
- 모든 API 호출 메서드에 `@_retry` 데코레이터 적용 (네트워크 오류 대비)
- get 계열 메서드는 실패 시 `None` 반환 (호출부에서 None 체크 필수)
- buy/sell 메서드는 실패 시 예외 발생 (`RuntimeError`)
- 인증 클라이언트 없이도 공개 API(시세/OHLCV)는 사용 가능
- OHLCV interval은 `_VALID_INTERVALS` 집합 안의 값만 허용

## 데이터 반환 형식
- `get_ohlcv()` → `pd.DataFrame(open, high, low, close, volume)` | None
- `get_current_price()` → `float` | None
- `buy()/sell()` → `dict` (API 응답)
