// Meta 캠페인 실제 ROAS 종합 분석 스크립트 (Cafe24 Pixel 기반)
import Database from "better-sqlite3";
import fetch from "node-fetch";

import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "..", "db", "meta_ads.db"));
const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = ?").get("default");
if (!cred) { console.log("No credentials"); process.exit(); }

const token = cred.access_token;
const accountId = cred.selected_ad_account_id.replace("act_", "");
const fields = "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,frequency,cpm,actions,action_values,purchase_roas";
const url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=${fields}&date_preset=last_30d&level=campaign&limit=15&access_token=${token}`;

const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
const json = await res.json();
if (json.error) { console.log("Error:", JSON.stringify(json.error)); process.exit(); }

console.log("============================================================");
console.log("        Meta 캠페인 실제 ROAS 분석 (Cafe24 Pixel 기준)");
console.log("============================================================\n");

let totalSpend = 0, totalRevenue = 0, totalPurchases = 0;

for (const c of (json.data || [])) {
  const spend = parseFloat(c.spend || "0");
  const roas = c.purchase_roas ? parseFloat(c.purchase_roas[0]?.value || "0") : 0;
  const pVal = (c.action_values || []).find(a => a.action_type === "omni_purchase");
  const pCnt = (c.actions || []).find(a => a.action_type === "omni_purchase");
  const revenue = pVal ? parseFloat(pVal.value) : 0;
  const purchases = pCnt ? parseInt(pCnt.value) : 0;
  const aov = purchases > 0 ? Math.round(revenue / purchases) : 0;
  const cpa = purchases > 0 ? Math.round(spend / purchases) : 0;
  totalSpend += spend; totalRevenue += revenue; totalPurchases += purchases;

  let status = "🔴 적자";
  if (roas >= 3) status = "🟢 우수";
  else if (roas >= 2) status = "🟡 양호";
  else if (roas >= 1) status = "🟠 손익분기";

  console.log("-".repeat(50));
  console.log("캠페인: " + c.campaign_name);
  console.log("  ROAS: " + roas.toFixed(2) + "x  " + status);
  console.log("  지출: W" + spend.toLocaleString() + " | 매출: W" + revenue.toLocaleString());
  console.log("  구매수: " + purchases + "건 | AOV: W" + aov.toLocaleString() + " | CPA: W" + cpa.toLocaleString());
  console.log("  CTR: " + parseFloat(c.ctr).toFixed(2) + "% | CPC: W" + Math.round(parseFloat(c.cpc)).toLocaleString() + " | Freq: " + parseFloat(c.frequency).toFixed(2));

  const views = (c.actions || []).find(a => a.action_type === "offsite_conversion.fb_pixel_view_content");
  const atc = (c.actions || []).find(a => a.action_type === "offsite_conversion.fb_pixel_add_to_cart");
  const ic = (c.actions || []).find(a => a.action_type === "offsite_conversion.fb_pixel_initiate_checkout");
  const purch = (c.actions || []).find(a => a.action_type === "offsite_conversion.fb_pixel_purchase");
  if (views) {
    const v = parseInt(views.value), a2 = atc ? parseInt(atc.value) : 0;
    const i = ic ? parseInt(ic.value) : 0, p = purch ? parseInt(purch.value) : 0;
    console.log("  퍼널: View(" + v + ") -> Cart(" + a2 + ", " + (v>0?(a2/v*100).toFixed(1):"0") + "%) -> Checkout(" + i + ", " + (a2>0?(i/a2*100).toFixed(1):"0") + "%) -> Purchase(" + p + ", " + (i>0?(p/i*100).toFixed(1):"0") + "%)");
  }
}

console.log("\n" + "=".repeat(50));
console.log("전체 합산");
console.log("  총 지출: W" + totalSpend.toLocaleString());
console.log("  총 매출: W" + totalRevenue.toLocaleString());
console.log("  총 구매: " + totalPurchases + "건");
console.log("  전체 ROAS: " + (totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "0") + "x");
console.log("  평균 AOV: W" + (totalPurchases > 0 ? Math.round(totalRevenue / totalPurchases).toLocaleString() : "0"));
console.log("  손익: W" + (totalRevenue - totalSpend).toLocaleString() + (totalRevenue >= totalSpend ? " (흑자)" : " (적자)"));
console.log("=".repeat(50));
db.close();
