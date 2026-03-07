// Settings 페이지 — Meta Ads OAuth 연동 + Cafe24 자사몰 연동 + 캠페인 동기화
import { useState, useEffect, useCallback } from "react";
import {
  Settings as SettingsIcon,
  Link,
  Unlink,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  ExternalLink,
  ChevronDown,
  ShoppingBag,
  Store,
} from "lucide-react";
import {
  MetaConfig,
  MetaStatus,
  MetaAdAccount,
  MetaSyncResult,
  fetchMetaConfig,
  saveMetaConfig,
  fetchMetaAuthUrl,
  fetchMetaStatus,
  disconnectMeta,
  fetchMetaAdAccounts,
  selectMetaAdAccount,
  syncMetaCampaigns,
  Cafe24Config,
  Cafe24Status,
  Cafe24SyncResult,
  fetchCafe24Config,
  saveCafe24Config,
  fetchCafe24AuthUrl,
  fetchCafe24Status,
  disconnectCafe24,
  syncCafe24Orders,
} from "../lib/api";

export default function Settings() {
  // ─── Meta 상태 ───
  const [config, setConfig] = useState<MetaConfig | null>(null);
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [syncResult, setSyncResult] = useState<MetaSyncResult | null>(null);

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");

  const [savingConfig, setSavingConfig] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectingAccount, setSelectingAccount] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Cafe24 상태 ───
  const [cafe24Config, setCafe24Config] = useState<Cafe24Config | null>(null);
  const [cafe24Status, setCafe24Status] = useState<Cafe24Status | null>(null);
  const [cafe24SyncResult, setCafe24SyncResult] = useState<Cafe24SyncResult | null>(null);

  const [mallId, setMallId] = useState("");
  const [cafe24ClientId, setCafe24ClientId] = useState("");
  const [cafe24ClientSecret, setCafe24ClientSecret] = useState("");

  const [savingCafe24, setSavingCafe24] = useState(false);
  const [connectingCafe24, setConnectingCafe24] = useState(false);
  const [disconnectingCafe24, setDisconnectingCafe24] = useState(false);
  const [syncingCafe24, setSyncingCafe24] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [cfg, sts] = await Promise.all([fetchMetaConfig(), fetchMetaStatus()]);
      setConfig(cfg);
      setStatus(sts);
    } catch (err) {
      console.error("Failed to load meta status:", err);
    }
  }, []);

  const loadCafe24Status = useCallback(async () => {
    try {
      const [cfg, sts] = await Promise.all([fetchCafe24Config(), fetchCafe24Status()]);
      setCafe24Config(cfg);
      setCafe24Status(sts);
    } catch (err) {
      console.error("Failed to load cafe24 status:", err);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadCafe24Status();
  }, [loadStatus, loadCafe24Status]);

  // ─── Meta 핸들러 ───

  const handleSaveConfig = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setError("App ID와 App Secret을 모두 입력해주세요.");
      return;
    }
    setSavingConfig(true);
    setError(null);
    try {
      await saveMetaConfig(appId.trim(), appSecret.trim());
      setAppId("");
      setAppSecret("");
      await loadStatus();
    } catch (err) {
      setError("설정 저장 실패. 다시 시도해주세요.");
      console.error(err);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await fetchMetaAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError("OAuth URL 생성 실패. App 자격증명을 먼저 설정해주세요.");
      setConnecting(false);
      console.error(err);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectMeta();
      setStatus({ connected: false });
      setAdAccounts([]);
      setSyncResult(null);
    } catch (err) {
      setError("연결 해제 실패.");
      console.error(err);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleLoadAccounts = async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const accounts = await fetchMetaAdAccounts();
      setAdAccounts(accounts);
    } catch (err) {
      setError("광고 계정 목록을 가져오지 못했습니다.");
      console.error(err);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleSelectAccount = async (accountId: string) => {
    setSelectingAccount(true);
    setError(null);
    try {
      await selectMetaAdAccount(accountId);
      await loadStatus();
    } catch (err) {
      setError("계정 선택 실패.");
      console.error(err);
    } finally {
      setSelectingAccount(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncMetaCampaigns();
      setSyncResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "동기화 실패";
      setError(msg);
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  // ─── Cafe24 핸들러 ───

  const handleSaveCafe24Config = async () => {
    if (!mallId.trim() || !cafe24ClientId.trim() || !cafe24ClientSecret.trim()) {
      setError("Mall ID, Client ID, Client Secret을 모두 입력해주세요.");
      return;
    }
    setSavingCafe24(true);
    setError(null);
    try {
      await saveCafe24Config(mallId.trim(), cafe24ClientId.trim(), cafe24ClientSecret.trim());
      setMallId("");
      setCafe24ClientId("");
      setCafe24ClientSecret("");
      await loadCafe24Status();
    } catch (err) {
      setError("Cafe24 설정 저장 실패.");
      console.error(err);
    } finally {
      setSavingCafe24(false);
    }
  };

  const handleConnectCafe24 = async () => {
    setConnectingCafe24(true);
    setError(null);
    try {
      const { url } = await fetchCafe24AuthUrl();
      window.location.href = url;
    } catch (err) {
      setError("Cafe24 OAuth URL 생성 실패. 설정을 먼저 확인해주세요.");
      setConnectingCafe24(false);
      console.error(err);
    }
  };

  const handleDisconnectCafe24 = async () => {
    setDisconnectingCafe24(true);
    setError(null);
    try {
      await disconnectCafe24();
      setCafe24Status({ connected: false });
      setCafe24SyncResult(null);
    } catch (err) {
      setError("Cafe24 연결 해제 실패.");
      console.error(err);
    } finally {
      setDisconnectingCafe24(false);
    }
  };

  const handleSyncCafe24 = async () => {
    setSyncingCafe24(true);
    setError(null);
    setCafe24SyncResult(null);
    try {
      const result = await syncCafe24Orders();
      setCafe24SyncResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Cafe24 동기화 실패";
      setError(msg);
      console.error(err);
    } finally {
      setSyncingCafe24(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* ═══ Meta Ads 섹션 ═══ */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon className="w-5 h-5 text-gray-500" />
          <h2 className="text-xl font-bold text-gray-900">Meta Ads 연동 설정</h2>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Section 1: App Credentials */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">1. App 자격증명</h3>
          <p className="text-xs text-gray-500 mb-4">
            Facebook Developer Console에서 App ID와 App Secret을 가져오세요.{" "}
            <a
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
            >
              Developer Console <ExternalLink className="w-3 h-3" />
            </a>
          </p>

          {config?.app_id_configured && (
            <div className="flex items-center gap-1.5 mb-3 text-green-600 text-xs">
              <CheckCircle className="w-3.5 h-3.5" />
              App 자격증명이 설정되어 있습니다.
            </div>
          )}

          <div className="space-y-3">
            <input
              type="text"
              placeholder="App ID"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="App Secret"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {savingConfig ? "저장 중..." : "저장"}
            </button>
          </div>
        </section>

        {/* Section 2: OAuth Connection */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">2. Meta 계정 연결</h3>

          {status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle className="w-4 h-4" />
                <span className="font-medium">{status.user_name || "Connected"}</span>
                {status.expires_at && (
                  <span className="text-xs text-gray-400">
                    (만료: {new Date(status.expires_at).toLocaleDateString()})
                  </span>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-1.5 px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                <Unlink className="w-4 h-4" />
                {disconnecting ? "해제 중..." : "연결 해제"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {status?.expired && (
                <div className="flex items-center gap-1.5 text-amber-600 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  토큰이 만료되었습니다. 다시 연결해주세요.
                </div>
              )}
              <button
                onClick={handleConnect}
                disabled={connecting || !config?.app_id_configured}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Link className="w-4 h-4" />
                {connecting ? "연결 중..." : "Connect to Meta"}
              </button>
              {!config?.app_id_configured && (
                <p className="text-xs text-gray-400">먼저 App 자격증명을 설정해주세요.</p>
              )}
            </div>
          )}
        </section>

        {/* Section 3: Ad Account Selection */}
        {status?.connected && (
          <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">3. 광고 계정 선택</h3>

            {status.selected_ad_account_id && (
              <div className="flex items-center gap-1.5 mb-3 text-green-600 text-xs">
                <CheckCircle className="w-3.5 h-3.5" />
                선택된 계정: {status.selected_ad_account_id}
              </div>
            )}

            <button
              onClick={handleLoadAccounts}
              disabled={loadingAccounts}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors mb-3"
            >
              {loadingAccounts ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              광고 계정 불러오기
            </button>

            {adAccounts.length > 0 && (
              <div className="relative">
                <select
                  value={status.selected_ad_account_id || ""}
                  onChange={(e) => handleSelectAccount(e.target.value)}
                  disabled={selectingAccount}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">계정을 선택하세요</option>
                  {adAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.id}) — {acc.currency}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}
          </section>
        )}

        {/* Section 4: Campaign Sync */}
        {status?.connected && status?.selected_ad_account_id && (
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">4. 캠페인 동기화</h3>
            <p className="text-xs text-gray-500 mb-4">
              선택한 광고 계정의 캠페인 성과 데이터를 가져와 Dashboard에 표시합니다.
            </p>

            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? "동기화 중..." : "Sync Campaigns"}
            </button>

            {syncResult && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="font-medium">{syncResult.synced}개 캠페인 동기화 완료</span>
                  {syncResult.failed > 0 && (
                    <span className="text-red-500 text-xs">({syncResult.failed}개 실패)</span>
                  )}
                </div>
                {syncResult.synced_campaigns.length > 0 && (
                  <ul className="text-xs text-gray-600 pl-6 list-disc space-y-0.5">
                    {syncResult.synced_campaigns.map((name, i) => (
                      <li key={i}>{name}</li>
                    ))}
                  </ul>
                )}
                {syncResult.errors && syncResult.errors.length > 0 && (
                  <div className="text-xs text-red-500 mt-2">
                    {syncResult.errors.map((e, i) => (
                      <div key={i}>
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        {e.campaign}: {e.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ═══ Cafe24 자사몰 섹션 ═══ */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Store className="w-5 h-5 text-green-600" />
          <h2 className="text-xl font-bold text-gray-900">Cafe24 자사몰 연동</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Cafe24 자사몰의 주문/매출 데이터를 연동하여 Meta 광고 → 실제 구매 전환을 추적합니다.
        </p>

        {/* Cafe24 Section 1: App 자격증명 */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-green-500" />
            1. Cafe24 앱 설정
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            Cafe24 Developer Center에서 앱을 생성하고 Client ID / Secret을 발급받으세요.{" "}
            <a
              href="https://developers.cafe24.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-600 hover:underline inline-flex items-center gap-0.5"
            >
              Developer Center <ExternalLink className="w-3 h-3" />
            </a>
          </p>

          {cafe24Config?.configured && (
            <div className="flex items-center gap-1.5 mb-3 text-green-600 text-xs">
              <CheckCircle className="w-3.5 h-3.5" />
              설정 완료 (Mall: {cafe24Config.mall_id})
            </div>
          )}

          <div className="space-y-3">
            <input
              type="text"
              placeholder="Mall ID (예: mystore)"
              value={mallId}
              onChange={(e) => setMallId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <input
              type="text"
              placeholder="Client ID"
              value={cafe24ClientId}
              onChange={(e) => setCafe24ClientId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <input
              type="password"
              placeholder="Client Secret"
              value={cafe24ClientSecret}
              onChange={(e) => setCafe24ClientSecret(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              onClick={handleSaveCafe24Config}
              disabled={savingCafe24}
              className="px-4 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
            >
              {savingCafe24 ? "저장 중..." : "저장"}
            </button>
          </div>
        </section>

        {/* Cafe24 Section 2: OAuth 연결 */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">2. Cafe24 계정 연결</h3>

          {cafe24Status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle className="w-4 h-4" />
                <span className="font-medium">연결됨 — {cafe24Status.mall_id}</span>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <div>
                  토큰: {cafe24Status.token_valid ? (
                    <span className="text-green-600">유효</span>
                  ) : (
                    <span className="text-amber-600">만료 (자동 갱신 예정)</span>
                  )}
                </div>
                {cafe24Status.refresh_expires_at && (
                  <div>
                    리프레시 만료: {new Date(cafe24Status.refresh_expires_at).toLocaleDateString()}
                    {!cafe24Status.refresh_valid && (
                      <span className="text-red-500 ml-1">(만료됨 — 재연동 필요)</span>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={handleDisconnectCafe24}
                disabled={disconnectingCafe24}
                className="flex items-center gap-1.5 px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                <Unlink className="w-4 h-4" />
                {disconnectingCafe24 ? "해제 중..." : "연결 해제"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleConnectCafe24}
                disabled={connectingCafe24 || !cafe24Config?.configured}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <Link className="w-4 h-4" />
                {connectingCafe24 ? "연결 중..." : "Connect to Cafe24"}
              </button>
              {!cafe24Config?.configured && (
                <p className="text-xs text-gray-400">먼저 Cafe24 앱 설정을 해주세요.</p>
              )}
            </div>
          )}
        </section>

        {/* Cafe24 Section 3: 주문 동기화 */}
        {cafe24Status?.connected && (
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">3. 주문 데이터 동기화</h3>
            <p className="text-xs text-gray-500 mb-4">
              최근 30일 주문 데이터를 가져와 Meta 광고와 매칭합니다. UTM 파라미터로 광고 귀인을 추적합니다.
            </p>

            <button
              onClick={handleSyncCafe24}
              disabled={syncingCafe24}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {syncingCafe24 ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncingCafe24 ? "동기화 중..." : "Sync Orders"}
            </button>

            {cafe24SyncResult && (
              <div className="mt-4 p-3 bg-green-50 rounded-lg text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="font-medium">{cafe24SyncResult.synced}건 주문 동기화 완료</span>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div>기간: {cafe24SyncResult.period.start} ~ {cafe24SyncResult.period.end}</div>
                  <div>
                    Meta 광고 귀인: <span className="font-medium text-blue-600">{cafe24SyncResult.meta_attributed}건</span>
                    {cafe24SyncResult.synced > 0 && (
                      <span className="text-gray-400 ml-1">
                        ({((cafe24SyncResult.meta_attributed / cafe24SyncResult.synced) * 100).toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
