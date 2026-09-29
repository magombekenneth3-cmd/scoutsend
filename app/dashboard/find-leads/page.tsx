"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/app/hooks/useToast";
import { ToastRegion } from "@/app/components/dashboard/ToastRegion";

interface Signal {
  signalType: string;
  confidence: number;
  explanation?: string;
}

interface Prospect {
  id: string;
  externalId?: string;
  firstName: string;
  lastName: string;
  companyName: string;
  website?: string | null;
  title: string;
  email?: string | null;
  emailStatus: string;
  seniority: string;
  location: string;
  linkedinUrl?: string | null;
  qualificationScore: number;
  source: string;
  signals?: Signal[];
}

interface CampaignOption {
  id: string;
  name: string;
}

const AI_COPILOT_PRESETS = [
  { label: "🚀 Founders at Series A SaaS", query: "Founder Series A SaaS", titles: ["Founder", "CEO"], stages: ["series_a"], signals: ["FUNDING"] },
  { label: "🔥 VPs of Sales Hiring SDRs", query: "VP Sales Hiring", titles: ["VP Sales", "Head of Sales"], stages: [], signals: ["HIRING"] },
  { label: "📈 Fast Growing Tech Execs", query: "Growth Tech", titles: ["CTO", "Head of Growth"], stages: ["series_b"], signals: ["GROWTH", "TECH"] },
];

const JOB_TITLE_PRESETS = ["Founder", "CEO", "VP Sales", "Head of Growth", "CTO", "CMO", "Director of Business Development"];
const SENIORITY_LEVELS = ["Owner", "C-Suite", "VP", "Director", "Manager"];
const FUNDING_STAGES = ["seed", "series_a", "series_b", "series_c"];
const TECH_PRESETS = ["HubSpot", "Salesforce", "React", "AWS", "Shopify"];

const SIGNAL_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  FUNDING_SIGNAL: { bg: "var(--signal-funding-bg)", border: "var(--signal-funding-border)", text: "var(--signal-funding-text)", label: "FUNDING" },
  HIRING_SIGNAL: { bg: "var(--signal-hiring-bg)", border: "var(--signal-hiring-border)", text: "var(--signal-hiring-text)", label: "HIRING" },
  GROWTH_SIGNAL: { bg: "var(--signal-growth-bg)", border: "var(--signal-growth-border)", text: "var(--signal-growth-text)", label: "GROWTH" },
  TECH_SIGNAL: { bg: "var(--signal-tech-bg)", border: "var(--signal-tech-border)", text: "var(--signal-tech-text)", label: "TECH" },
  INTENT_SIGNAL: { bg: "var(--signal-intent-bg)", border: "var(--signal-intent-border)", text: "var(--signal-intent-text)", label: "INTENT" },
};

const PAGE_SIZE = 25;

export default function FindLeadsPage() {
  const [query, setQuery] = useState("");
  const [selectedTitles, setSelectedTitles] = useState<string[]>(["Founder", "CEO"]);
  const [selectedSeniorities, setSelectedSeniorities] = useState<string[]>(["C-Suite"]);
  const [selectedCompanySizes, setSelectedCompanySizes] = useState<string[]>([]);
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [selectedFundingStages, setSelectedFundingStages] = useState<string[]>([]);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  const [selectedTech, setSelectedTech] = useState<string[]>([]);

  const [page, setPage] = useState(1);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [previewProspect, setPreviewProspect] = useState<Prospect | null>(null);
  const [batchEnriching, setBatchEnriching] = useState(false);

  const { toasts, addToast, dismiss } = useToast();
  const showToast = useCallback((text: string, type: "success" | "info" | "error" = "info") => {
    addToast(type, text);
  }, [addToast]);

  const searchProspects = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      const res = await fetch("/api/prospecting/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: query,
          titles: selectedTitles,
          seniorities: selectedSeniorities,
          industries: selectedIndustry ? [selectedIndustry] : [],
          employeeRanges: selectedCompanySizes,
          fundingStages: selectedFundingStages,
          signals: selectedSignals,
          technologies: selectedTech,
          page: targetPage,
          limit: PAGE_SIZE,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setProspects(json.data || []);
      } else {
        showToast("Failed to search decision-maker database", "error");
      }
    } catch {
      showToast("Network error during lead discovery", "error");
    } finally {
      setLoading(false);
    }
  }, [
    query,
    selectedTitles,
    selectedSeniorities,
    selectedIndustry,
    selectedCompanySizes,
    selectedFundingStages,
    selectedSignals,
    selectedTech,
    page,
    showToast,
  ]);

  useEffect(() => {
    searchProspects(page);
  }, [page, searchProspects]);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.data)) {
          setCampaigns(data.data.map((c: any) => ({ id: c.id, name: c.name })));
          if (data.data.length > 0) setSelectedCampaignId(data.data[0].id);
        }
      })
      .catch(() => { });
  }, []);

  const applyCopilotPreset = (preset: typeof AI_COPILOT_PRESETS[0]) => {
    setQuery(preset.query);
    setSelectedTitles(preset.titles);
    setSelectedFundingStages(preset.stages);
    setSelectedSignals(preset.signals);
    setPage(1);
  };

  const handleFilterSearch = () => {
    setPage(1);
    searchProspects(1);
  };

  const goToNextPage = () => {
    setPage((prev) => prev + 1);
  };

  const goToPrevPage = () => {
    setPage((prev) => Math.max(1, prev - 1));
  };

  const toggleTitle = (title: string) => {
    setSelectedTitles((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const toggleSeniority = (seniority: string) => {
    setSelectedSeniorities((prev) =>
      prev.includes(seniority) ? prev.filter((s) => s !== seniority) : [...prev, seniority]
    );
  };

  const toggleFundingStage = (stage: string) => {
    setSelectedFundingStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  };

  const toggleSignal = (signal: string) => {
    setSelectedSignals((prev) =>
      prev.includes(signal) ? prev.filter((s) => s !== signal) : [...prev, signal]
    );
  };

  const toggleTech = (tech: string) => {
    setSelectedTech((prev) =>
      prev.includes(tech) ? prev.filter((t) => t !== tech) : [...prev, tech]
    );
  };

  const toggleSelectAll = () => {
    if (selectedProspectIds.size === prospects.length) {
      setSelectedProspectIds(new Set());
    } else {
      setSelectedProspectIds(new Set(prospects.map((p) => p.id)));
    }
  };

  const toggleSelectProspect = (id: string) => {
    const next = new Set(selectedProspectIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedProspectIds(next);
  };

  const enrichLeadEmail = async (prospect: Prospect) => {
    const id = prospect.id;
    setEnrichingIds((prev) => new Set(prev).add(id));
    showToast(`Enriching & verifying email for ${prospect.firstName} ${prospect.lastName}...`, "info");

    try {
      const res = await fetch("/api/prospecting/reveal-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalId: prospect.externalId || prospect.id,
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          companyName: prospect.companyName,
          website: prospect.website,
          currentEmail: prospect.email,
          linkedinUrl: prospect.linkedinUrl,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const updated = {
          ...prospect,
          email: json.email,
          emailStatus: json.emailStatus,
          qualificationScore: json.emailStatus === "VERIFIED" ? 0.95 : 0.80,
        };

        setProspects((prev) => prev.map((p) => (p.id === id ? updated : p)));
        if (previewProspect?.id === id) {
          setPreviewProspect(updated);
        }
        showToast(`Email revealed (${json.source}): ${json.email}`, "success");
      } else {
        showToast("Email enrichment failed", "error");
      }
    } catch {
      showToast("Email enrichment failed", "error");
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const batchRevealSelectedEmails = async () => {
    const selectedList = prospects.filter((p) => selectedProspectIds.has(p.id));
    if (selectedList.length === 0) return;

    setBatchEnriching(true);
    showToast(`Batch revealing ${selectedList.length} emails...`, "info");

    for (const p of selectedList) {
      await enrichLeadEmail(p);
    }
    setBatchEnriching(false);
    showToast(`Batch email reveal completed!`, "success");
  };

  const saveProspectsToLeadsDatabase = async (prospectsToSave: Prospect[]) => {
    if (prospectsToSave.length === 0) {
      showToast("Select at least one prospect to save", "info");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/prospecting/save-to-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospects: prospectsToSave,
          campaignId: selectedCampaignId || undefined,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        showToast(`Saved ${json.inserted} lead(s) into your Leads Database!`, "success");
        setSelectedProspectIds(new Set());
      } else {
        showToast("Failed to save leads into database", "error");
      }
    } catch {
      showToast("Error saving leads into database", "error");
    } finally {
      setSaving(false);
    }
  };

  const exportSelectedCsv = () => {
    if (selectedProspectIds.size === 0) {
      showToast("Select prospects to export", "info");
      return;
    }
    const selected = prospects.filter((p) => selectedProspectIds.has(p.id));
    const headers = ["First Name", "Last Name", "Title", "Company", "Website", "Email", "Status", "Score", "Location"];
    const rows = selected.map((p) => [
      p.firstName,
      p.lastName,
      `"${p.title}"`,
      `"${p.companyName}"`,
      p.website || "",
      p.email || "",
      p.emailStatus,
      p.qualificationScore,
      `"${p.location}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `prospects_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${selected.length} prospects to CSV`, "success");
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--background)] relative">
      <ToastRegion toasts={toasts} onDismiss={dismiss} />

      <aside className="w-80 flex-shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-5 overflow-y-auto space-y-6">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-[var(--text-primary)] font-display tracking-tight">
              Lead Discovery
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-[var(--red-glow)] text-[var(--red-text)] text-[10px] font-bold border border-[var(--border-red)]">
              275M+ Contacts
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Amplemarket-inspired AI sales intelligence & intent radar
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
            AI Copilot Search
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe your ICP or target persona..."
            className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--red)] transition-colors"
          />

          <div className="mt-2 space-y-1.5">
            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
              Popular AI Prompts
            </span>
            <div className="flex flex-col gap-1">
              {AI_COPILOT_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => applyCopilotPreset(preset)}
                  className="text-left px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all flex items-center justify-between"
                >
                  <span>{preset.label}</span>
                  <span className="text-[9px] font-mono text-[var(--red-text)]">Apply →</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
            Buying Intent Signals
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { id: "HIRING", label: "Hiring Surge" },
              { id: "FUNDING", label: "Funding Raised" },
              { id: "GROWTH", label: "Growth Surge" },
              { id: "TECH", label: "Tech Fit" },
            ].map((sig) => {
              const active = selectedSignals.includes(sig.id);
              return (
                <button
                  key={sig.id}
                  onClick={() => toggleSignal(sig.id)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium border text-center transition-all ${active
                      ? "bg-[var(--red-glow)] border-[var(--red)] text-[var(--red-text)]"
                      : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-secondary)]"
                    }`}
                >
                  {sig.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
            Funding Stage
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {FUNDING_STAGES.map((stage) => {
              const active = selectedFundingStages.includes(stage);
              return (
                <button
                  key={stage}
                  onClick={() => toggleFundingStage(stage)}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border uppercase text-center transition-all ${active
                      ? "bg-[var(--success-bg)] border-[var(--success-border)] text-[var(--success-text)]"
                      : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-secondary)]"
                    }`}
                >
                  {stage.replace("_", " ")}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
            Job Titles
          </label>
          <div className="flex flex-wrap gap-1.5">
            {JOB_TITLE_PRESETS.map((title) => {
              const active = selectedTitles.includes(title);
              return (
                <button
                  key={title}
                  onClick={() => toggleTitle(title)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${active
                      ? "bg-[var(--red)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)]"
                    }`}
                >
                  {title}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
            Technologies Used
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TECH_PRESETS.map((tech) => {
              const active = selectedTech.includes(tech);
              return (
                <button
                  key={tech}
                  onClick={() => toggleTech(tech)}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border transition-all ${active
                      ? "bg-[var(--signal-tech-bg)] border-[var(--signal-tech-border)] text-[var(--signal-tech-text)]"
                      : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-secondary)]"
                    }`}
                >
                  {tech}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
            Seniority
          </label>
          <div className="space-y-1.5">
            {SENIORITY_LEVELS.map((sen) => {
              const checked = selectedSeniorities.includes(sen);
              return (
                <label key={sen} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSeniority(sen)}
                    className="rounded border-[var(--border)] text-[var(--red)] focus:ring-0"
                  />
                  <span>{sen}</span>
                </label>
              );
            })}
          </div>
        </div>

        <button
          onClick={handleFilterSearch}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-[var(--red)] hover:bg-[var(--red-dim)] text-white text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <span>Filter Decision Makers</span>
          )}
        </button>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-16 px-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)]/50 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-base font-semibold text-[var(--text-primary)]">
              Explore Available Leads
            </h1>
            <span className="px-2.5 py-1 rounded-full bg-[var(--surface-2)] text-xs font-mono font-medium text-[var(--text-secondary)] border border-[var(--border)]">
              Page {page} • {prospects.length} available
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--border)] mr-2">
              <button
                onClick={goToPrevPage}
                disabled={page === 1 || loading}
                className="px-2.5 py-1 rounded text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-40 transition-all"
                title="Previous Page"
              >
                ← Prev
              </button>
              <span className="px-2 text-xs font-mono text-[var(--text-secondary)]">{page}</span>
              <button
                onClick={goToNextPage}
                disabled={prospects.length < PAGE_SIZE || loading}
                className="px-2.5 py-1 rounded text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-40 transition-all"
                title="Next Page"
              >
                Next →
              </button>
            </div>

            {campaigns.length > 0 && (
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    Target Campaign: {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 pb-24">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-[var(--text-muted)]">
              <div className="w-8 h-8 border-2 border-[var(--red)] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium">Fetching available prospects...</p>
            </div>
          ) : prospects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-[var(--border)] rounded-2xl p-8">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">No prospects found on Page {page}</p>
              <p className="text-xs text-[var(--text-muted)] mb-4 font-mono">Try adjusting your filters or going back to Page 1</p>
              <button
                onClick={() => {
                  setSelectedTitles(["Founder", "CEO"]);
                  setSelectedSignals([]);
                  setSelectedFundingStages([]);
                  setQuery("");
                  setPage(1);
                }}
                className="px-4 py-2 rounded-lg bg-[var(--surface-2)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface)] border border-[var(--border)]"
              >
                Reset Filters & Back to Page 1
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface)] shadow-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--surface-2)] border-b border-[var(--border)] text-[var(--text-muted)] font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="p-3.5 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedProspectIds.size === prospects.length && prospects.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-[var(--border)] text-[var(--red)] focus:ring-0 cursor-pointer"
                        />
                      </th>
                      <th className="p-3.5">Prospect Name & Title</th>
                      <th className="p-3.5">Company & Domain</th>
                      <th className="p-3.5">Buying Intent Signals</th>
                      <th className="p-3.5">Email Status</th>
                      <th className="p-3.5 text-right">Explore & Import</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {prospects.map((p) => {
                      const isSelected = selectedProspectIds.has(p.id);
                      const isEnriching = enrichingIds.has(p.id);
                      const initials = `${p.firstName[0] || ""}${p.lastName[0] || ""}`.toUpperCase() || "P";

                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-[var(--glass-bg-hover)] transition-colors cursor-pointer ${isSelected ? "bg-[var(--red-glow)]/15 border-l-2 border-l-[var(--red)]" : ""
                            }`}
                        >
                          <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectProspect(p.id)}
                              className="rounded border-[var(--border)] text-[var(--red)] focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="p-3.5" onClick={() => setPreviewProspect(p)}>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-[var(--red)] text-white font-bold flex items-center justify-center text-xs flex-shrink-0">
                                {initials}
                              </div>
                              <div>
                                <p className="font-semibold text-[var(--text-primary)] hover:text-[var(--red-text)] transition-colors">
                                  {p.firstName} {p.lastName}
                                </p>
                                <p className="text-[11px] text-[var(--text-muted)]">{p.title}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-3.5" onClick={() => setPreviewProspect(p)}>
                            <p className="font-medium text-[var(--text-primary)]">{p.companyName}</p>
                            {p.website && (
                              <a
                                href={p.website.startsWith("http") ? p.website : `https://${p.website}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[11px] text-[var(--red-text)] hover:underline font-mono"
                              >
                                {p.website.replace(/^https?:\/\//, "")}
                              </a>
                            )}
                          </td>
                          <td className="p-3.5" onClick={() => setPreviewProspect(p)}>
                            <div className="flex flex-wrap gap-1">
                              {(p.signals || []).map((sig, idx) => {
                                const cfg = SIGNAL_STYLES[sig.signalType] || SIGNAL_STYLES.INTENT_SIGNAL;
                                return (
                                  <span
                                    key={idx}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      padding: "2px 8px",
                                      borderRadius: "8px",
                                      fontSize: "9px",
                                      fontWeight: 700,
                                      letterSpacing: "0.04em",
                                      background: cfg.bg,
                                      border: `1px solid ${cfg.border}`,
                                      color: cfg.text,
                                    }}
                                    title={sig.explanation}
                                  >
                                    {cfg.label}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td className="p-3.5" onClick={() => setPreviewProspect(p)}>
                            {p.email ? (
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-[var(--text-primary)]">{p.email}</span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success-text)]">
                                  {p.emailStatus}
                                </span>
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-text)]">
                                Click to Reveal
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-right flex items-center justify-end gap-2">
                            <button
                              onClick={() => setPreviewProspect(p)}
                              className="px-2.5 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[11px] font-semibold text-[var(--text-primary)] hover:border-[var(--red)] transition-all"
                            >
                              Explore Details
                            </button>
                            <button
                              onClick={() => saveProspectsToLeadsDatabase([p])}
                              disabled={saving}
                              className="px-2.5 py-1 rounded-md bg-[var(--red)] text-white text-[11px] font-semibold hover:bg-[var(--red-dim)] transition-all"
                            >
                              + Add to Database
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-[var(--text-muted)] font-mono">
                  Showing Page {page} (25 items per page)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={goToPrevPage}
                    disabled={page === 1 || loading}
                    className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-40 transition-all"
                  >
                    ← Previous Page
                  </button>
                  <button
                    onClick={goToNextPage}
                    disabled={prospects.length < PAGE_SIZE || loading}
                    className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-40 transition-all"
                  >
                    Next Page →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {selectedProspectIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-5 duration-300">
            <div className="px-5 py-3 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow-lg)] flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2 border-r border-[var(--border)] pr-4">
                <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                <span className="font-bold text-[var(--text-primary)] font-mono">
                  {selectedProspectIds.size} Selected
                </span>
              </div>

              <button
                onClick={batchRevealSelectedEmails}
                disabled={batchEnriching}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--red)] hover:bg-[var(--red-dim)] text-white font-bold transition-all flex items-center gap-1.5"
              >
                {batchEnriching ? "Revealing..." : "⚡ Batch Reveal Emails"}
              </button>

              <button
                onClick={() => saveProspectsToLeadsDatabase(prospects.filter((p) => selectedProspectIds.has(p.id)))}
                disabled={saving}
                className="px-4 py-1.5 rounded-xl bg-[var(--red)] hover:bg-[var(--red-dim)] text-white font-bold transition-all"
              >
                {saving ? "Saving..." : `📥 Add ${selectedProspectIds.size} to Database`}
              </button>

              <button
                onClick={exportSelectedCsv}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--navy-mid)] text-[var(--text-secondary)] border border-[var(--border)] font-medium transition-all"
              >
                📊 Export CSV
              </button>

              <button
                onClick={() => setSelectedProspectIds(new Set())}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] font-bold text-xs ml-1"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </main>

      {previewProspect && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[var(--surface)] border-l border-[var(--border)] h-full overflow-y-auto p-6 shadow-[var(--shadow-lg)] flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--red)] text-white font-bold flex items-center justify-center text-sm">
                    {`${previewProspect.firstName[0] || ""}${previewProspect.lastName[0] || ""}`.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-[var(--text-primary)]">
                      {previewProspect.firstName} {previewProspect.lastName}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">{previewProspect.title}</p>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewProspect(null)}
                  className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Company & Domain Profile
                  </span>
                  <p className="font-bold text-sm text-[var(--text-primary)]">{previewProspect.companyName}</p>
                  <p className="text-xs text-[var(--text-secondary)]">Location: {previewProspect.location}</p>
                  <p className="text-xs text-[var(--text-secondary)]">Seniority: {previewProspect.seniority}</p>

                  {previewProspect.website && (
                    <a
                      href={previewProspect.website.startsWith("http") ? previewProspect.website : `https://${previewProspect.website}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs font-semibold text-[var(--red-text)] hover:underline mt-1 font-mono"
                    >
                      🌐 {previewProspect.website}
                    </a>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Contact & Email Intelligence
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success-text)]">
                      {previewProspect.emailStatus}
                    </span>
                  </div>

                  {previewProspect.email ? (
                    <div className="p-3 rounded-lg bg-[var(--success-bg)] border border-[var(--success-border)] font-mono text-xs text-[var(--success-text)] break-all">
                      {previewProspect.email}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-[var(--text-muted)]">Email unverified. Run waterfall reveal to discover contact address.</p>
                      <button
                        onClick={() => enrichLeadEmail(previewProspect)}
                        disabled={enrichingIds.has(previewProspect.id)}
                        className="w-full py-2.5 rounded-lg bg-[var(--surface)] border border-[var(--red)] text-xs font-bold text-[var(--red-text)] hover:bg-[var(--red-glow)]/20 transition-all flex items-center justify-center gap-2"
                      >
                        {enrichingIds.has(previewProspect.id) ? (
                          <div className="w-3.5 h-3.5 border-2 border-[var(--red)] border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <span>⚡ Reveal & Verify Email Address</span>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Intent Signals & Fit Score
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-[var(--surface-2)] rounded-full h-2 overflow-hidden border border-[var(--border)]">
                      <div
                        className="bg-gradient-to-r from-[var(--warning)] to-[var(--success)] h-full rounded-full"
                        style={{ width: `${Math.round((previewProspect.qualificationScore || 0.8) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono font-bold text-[var(--success-text)]">
                      {Math.round((previewProspect.qualificationScore || 0.8) * 100)}% Match
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    {(previewProspect.signals || []).map((sig, idx) => (
                      <div key={idx} className="p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs space-y-0.5">
                        <span className="font-bold text-[10px] text-[var(--warning-text)] uppercase tracking-wider block">
                          {sig.signalType} ({(sig.confidence * 100).toFixed(0)}% Confidence)
                        </span>
                        <p className="text-[11px] text-[var(--text-secondary)]">{sig.explanation || "Buying intent trigger detected"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-[var(--border)] space-y-2">
              <button
                onClick={() => {
                  saveProspectsToLeadsDatabase([previewProspect]);
                  setPreviewProspect(null);
                }}
                disabled={saving}
                className="w-full py-3 rounded-xl bg-[var(--red)] hover:bg-[var(--red-dim)] text-white text-xs font-bold transition-all flex items-center justify-center gap-2"
              >
                {saving ? "Importing..." : "+ Add to My Leads Database"}
              </button>

              {previewProspect.linkedinUrl && (
                <a
                  href={previewProspect.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface)] text-center block"
                >
                  View LinkedIn Profile
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}