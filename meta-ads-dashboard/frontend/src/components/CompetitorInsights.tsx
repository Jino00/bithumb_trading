// 경쟁사 인텔리전스 패널 — 추가/분석/전략 스틸
import { useState } from "react";
import { Plus, Search, Trash2, Zap, Loader2, Globe, TrendingUp, Target } from "lucide-react";
import { Competitor, addCompetitor, analyzeCompetitor, stealStrategy, deleteCompetitor } from "../lib/api";

interface Props {
  competitors: Competitor[];
  onRefresh: () => void;
}

export default function CompetitorInsights({ competitors, onRefresh }: Props) {
  const [name, setName] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [stealingId, setStealingId] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<Record<string, unknown> | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      await addCompetitor(name.trim(), pageUrl.trim() || undefined);
      setName("");
      setPageUrl("");
      setShowForm(false);
      onRefresh();
    } catch (err) {
      console.error("Failed to add competitor:", err);
    } finally {
      setAdding(false);
    }
  };

  const handleAnalyze = async (id: number) => {
    setAnalyzingId(id);
    try {
      await analyzeCompetitor(id);
      onRefresh();
    } catch (err) {
      console.error("Failed to analyze competitor:", err);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleSteal = async (id: number) => {
    setStealingId(id);
    try {
      const result = await stealStrategy(id);
      setStrategy(result as Record<string, unknown>);
    } catch (err) {
      console.error("Failed to generate strategy:", err);
    } finally {
      setStealingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCompetitor(id);
      onRefresh();
    } catch (err) {
      console.error("Failed to delete competitor:", err);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Competitor Intelligence</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Competitor
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-2">
          <input
            type="text"
            placeholder="Competitor name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Facebook page URL (optional)"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !name.trim()}
            className="w-full px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {adding ? "Adding..." : "Add Competitor"}
          </button>
        </div>
      )}

      {competitors.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Globe className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">Add competitors to track their ad strategies</p>
        </div>
      ) : (
        <div className="space-y-3">
          {competitors.map((comp) => (
            <div key={comp.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-sm text-gray-900">{comp.name}</h3>
                  {comp.page_url && <p className="text-xs text-blue-600 truncate max-w-xs">{comp.page_url}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleAnalyze(comp.id)}
                    disabled={analyzingId === comp.id}
                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Get Fresh Intel"
                  >
                    {analyzingId === comp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </button>
                  {comp.insights && (
                    <button
                      onClick={() => handleSteal(comp.id)}
                      disabled={stealingId === comp.id}
                      className="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition-colors"
                      title="Steal Strategy"
                    >
                      {stealingId === comp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(comp.id)}
                    className="p-1.5 text-red-400 hover:bg-red-50 rounded transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {comp.insights && (
                <div className="mt-3 space-y-2 text-xs">
                  <p className="text-gray-600">{comp.insights.strategy_summary}</p>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 p-2 rounded">
                      <div className="flex items-center gap-1 font-semibold text-gray-700 mb-1">
                        <Target className="w-3 h-3" /> Top Formats
                      </div>
                      {comp.insights.top_formats.map((f, i) => (
                        <div key={i} className="text-gray-600">{f}</div>
                      ))}
                    </div>
                    <div className="bg-gray-50 p-2 rounded">
                      <div className="flex items-center gap-1 font-semibold text-gray-700 mb-1">
                        <TrendingUp className="w-3 h-3" /> Themes
                      </div>
                      {comp.insights.messaging_themes.slice(0, 3).map((t, i) => (
                        <div key={i} className="text-gray-600">{t}</div>
                      ))}
                    </div>
                  </div>

                  <div className="text-gray-500">
                    Est. spend: <span className="font-medium">{comp.insights.estimated_monthly_spend}</span>
                  </div>

                  {comp.last_analyzed && (
                    <div className="text-gray-400">Last analyzed: {new Date(comp.last_analyzed).toLocaleDateString()}</div>
                  )}
                </div>
              )}

              {!comp.insights && (
                <p className="text-xs text-gray-400 mt-2">Click the search icon to analyze this competitor</p>
              )}
            </div>
          ))}
        </div>
      )}

      {strategy && (
        <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-purple-900">
              <Zap className="w-4 h-4 inline mr-1" />
              Inspired Strategy
            </h3>
            <button onClick={() => setStrategy(null)} className="text-xs text-gray-500 hover:text-gray-700">
              Dismiss
            </button>
          </div>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-auto max-h-64">
            {JSON.stringify(strategy, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
