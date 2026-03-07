// 캠페인 편집 모달 — 캠페인 CRUD
import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Campaign, updateCampaign, createCampaign } from "../lib/api";

interface Props {
  campaign: Campaign | null;
  isNew?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function CampaignEditor({ campaign, isNew, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: "",
    status: "active",
    ctr: 0,
    roas: 0,
    cpc: 0,
    frequency: 0,
    daily_spend: 0,
    total_spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (campaign && !isNew) {
      setForm({
        name: campaign.name,
        status: campaign.status,
        ctr: campaign.ctr,
        roas: campaign.roas,
        cpc: campaign.cpc,
        frequency: campaign.frequency,
        daily_spend: campaign.daily_spend,
        total_spend: campaign.total_spend,
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        conversions: campaign.conversions,
      });
    }
  }, [campaign, isNew]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) {
        await createCampaign(form);
      } else if (campaign) {
        await updateCampaign(campaign.id, form);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save campaign:", err);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            {isNew ? "New Campaign" : "Edit Campaign"}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Campaign Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              required
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">CTR (%)</label>
              <input
                type="number"
                step="0.1"
                value={form.ctr}
                onChange={(e) => updateField("ctr", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ROAS (x)</label>
              <input
                type="number"
                step="0.1"
                value={form.roas}
                onChange={(e) => updateField("roas", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">CPC ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.cpc}
                onChange={(e) => updateField("cpc", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Frequency</label>
              <input
                type="number"
                step="0.1"
                value={form.frequency}
                onChange={(e) => updateField("frequency", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Daily Spend ($)</label>
              <input
                type="number"
                step="1"
                value={form.daily_spend}
                onChange={(e) => updateField("daily_spend", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Total Spend ($)</label>
              <input
                type="number"
                step="1"
                value={form.total_spend}
                onChange={(e) => updateField("total_spend", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Impressions</label>
              <input
                type="number"
                value={form.impressions}
                onChange={(e) => updateField("impressions", parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Conversions</label>
              <input
                type="number"
                value={form.conversions}
                onChange={(e) => updateField("conversions", parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : isNew ? "Create Campaign" : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
