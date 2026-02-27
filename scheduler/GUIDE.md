# scheduler/ — 주기 실행 스케줄러

## 파일 구조
- `schedule_config.py`: schedule 라이브러리 기반 주기 설정

## 함수
- `setup_openclaw_schedule()`: 전체 스케줄 (5분 매매, 1시간 성과, 일/주 백테스트)
- `setup_schedule()`: 단순 주기 (기존 호환용)
- `setup_fixed_times()`: 매일 특정 시각 실행

## 규칙
- 새 스케줄 추가 시 반드시 logger.info()로 등록 사실을 로그에 남긴다
- schedule.clear()는 새 설정 전에만 호출 (기존 스케줄 날려먹지 않게 주의)
- 주기 값은 config.py에서 관리 (SCHEDULE_INTERVAL_MINUTES)
