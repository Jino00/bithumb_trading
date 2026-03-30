#!/bin/bash
# Oracle Cloud VM 초기 설정 스크립트
# 사용법: ssh user@<VM_IP> 'bash -s' < deploy/setup_oracle_vm.sh

set -e

echo "=== Oracle VM 초기 설정 ==="

# 1. 시스템 업데이트
sudo apt-get update && sudo apt-get upgrade -y

# 2. Python 3.13 설치 (deadsnakes PPA)
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt-get update
sudo apt-get install -y python3.13 python3.13-venv python3.13-dev

# 3. 필수 도구
sudo apt-get install -y git tmux htop sqlite3 curl

# 4. 프로젝트 디렉토리
mkdir -p ~/bithumb-trading
cd ~/bithumb-trading

# 5. Python venv
python3.13 -m venv .venv
source .venv/bin/activate

# 6. pip 업그레이드
pip install --upgrade pip

echo ""
echo "=== 초기 설정 완료 ==="
echo "다음 단계:"
echo "  1. deploy/deploy.sh 실행 (코드 + 의존성 전송)"
echo "  2. .env 파일 설정"
echo "  3. deploy/start.sh 실행 (봇 시작)"
