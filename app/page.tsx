"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  StaggerContainer,
  StaggerItem,
  MotionCard,
  AnimatedCounter,
  MagneticButton,
} from "./components/ui/motion";
import {
  Radar,
  Zap,
  Search,
  Sparkles,
  ShieldCheck,
  Cpu,
  Layers,
  Database,
  Mail,
  Globe,
  Building2,
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  Bot,
  Activity,
  Users,
  ChevronRight,
  Check,
  RefreshCw,
  BarChart3,
  ShieldAlert,
} from "lucide-react";

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.7a1.63 1.63 0 1 0 0 3.26 1.63 1.63 0 0 0 0-3.26Z" />
    </svg>
  );
}

interface StatItem { value: string; label: string; sub?: string }
interface FeatureCard { icon: React.ReactNode; tag: string; title: string; desc: string; accent?: boolean }
interface TestimonialItem { quote: string; name: string; role: string; company: string; initials: string }

const STATS: StatItem[] = [
  { value: "275M+", label: "Verified B2B Decision Makers", sub: "global contact coverage" },
  { value: "4.2M", label: "Emails Delivered Monthly", sub: "last 30 days" },
  { value: "12×", label: "Reply Rate Lift", sub: "over traditional cold lists" },
  { value: "99.7%", label: "Deliverability Rate", sub: "across all domains" },
];

const FEATURES: FeatureCard[] = [
  {
    icon: <Radar className="w-5 h-5 text-indigo-500" />,
    tag: "Buying Signals Radar",
    title: "Real-Time Intent Detection",
    desc: "Detect funding rounds, hiring surges, leadership changes, and tech stack adoption the moment they happen.",
    accent: true,
  },
  {
    icon: <Search className="w-5 h-5 text-violet-500" />,
    tag: "Lead Discovery Engine",
    title: "275M+ Decision Maker Database",
    desc: "Filter by title, seniority, funding stage, hiring velocity, and tech stack without relying on single vendor silos.",
  },
  {
    icon: <Zap className="w-5 h-5 text-amber-500" />,
    tag: "Waterfall Verification",
    title: "Multi-Source Email Reveal",
    desc: "Cascade across local DB cache, Google SERP web search, Gemini AI syntax prediction, and live DNS MX validation.",
  },
  {
    icon: <Sparkles className="w-5 h-5 text-rose-500" />,
    tag: "AI Copy Engine",
    title: "Signal-Driven Personalisation",
    desc: "Gemini writes tailored emails referencing real-time buying signals rather than generic mail-merge placeholders.",
  },
  {
    icon: <ShieldCheck className="w-5 h-5 text-emerald-500" />,
    tag: "Deliverability Shield",
    title: "Domain Health & Spam Review",
    desc: "Automated daily send limits, warmup schedules, and bounce rate throttling to safeguard your sender reputation.",
  },
  {
    icon: <Bot className="w-5 h-5 text-sky-500" />,
    tag: "Self-Improving Loop",
    title: "Continuous AI Optimization",
    desc: "Every open, click, and reply trains the model to continuously elevate response rates for your specific ICP.",
  },
];

const DOMAIN_SECTION_BULLETS = [
  { icon: <Zap className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />, text: "Automatic warmup schedules for new sender domains" },
  { icon: <ShieldAlert className="w-5 h-5 text-rose-500 mt-0.5 shrink-0" />, text: "Hard stops when bounce > 5% or complaint > 0.1%" },
  { icon: <BarChart3 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />, text: "Real-time MX & DNS deliverability score monitoring" },
];

const PIPELINE_STEPS = [
  { label: "Signal Radar", color: "#6366f1", icon: <Radar className="w-5 h-5" /> },
  { label: "Lead Discovery", color: "#8b5cf6", icon: <Search className="w-5 h-5" /> },
  { label: "Waterfall Reveal", color: "#ec4899", icon: <Zap className="w-5 h-5" /> },
  { label: "AI Copy Gen", color: "var(--red)", icon: <Sparkles className="w-5 h-5" /> },
  { label: "Smart Send", color: "var(--success)", icon: <Mail className="w-5 h-5" /> },
];

const TESTIMONIALS: TestimonialItem[] = [
  {
    quote: "We closed 3 enterprise deals in the first campaign. The intent signals found leads our SDR team would have missed completely.",
    name: "Amara Nwosu",
    role: "Head of Sales",
    company: "Stackvault",
    initials: "AN",
  },
  {
    quote: "The waterfall email reveal and deliverability safeguards are top tier. Our domain health stays 99%+ healthy across all campaigns.",
    name: "Priya Mehta",
    role: "Growth Lead",
    company: "Orbient",
    initials: "PM",
  },
  {
    quote: "Our reply rate went from 1.4% to 17% in 6 weeks. Prospects genuinely think we spent hours researching them manually.",
    name: "Tobias Kern",
    role: "Founder",
    company: "Layrlink",
    initials: "TK",
  },
];

function RadarOrb() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: "min(420px, 100%)", height: "min(420px, 100%)" }}>
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          initial={{ scale: 0.8, opacity: 0.8 }}
          animate={{ scale: [0.8, 1.4], opacity: [0.8, 0] }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            delay: i * 0.6,
            ease: "easeOut",
          }}
          className="absolute rounded-full border border-[var(--border-red)] pointer-events-none"
          style={{
            width: `${100 + i * 80}px`,
            height: `${100 + i * 80}px`,
          }}
        />
      ))}

      {[180, 260, 340, 410].map((size, i) => (
        <div
          key={i}
          className="absolute rounded-full border"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            borderColor: "rgba(255,255,255,0.05)",
          }}
        />
      ))}

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.04)" }} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div style={{ width: 1, height: "100%", background: "rgba(255,255,255,0.04)" }} />
      </div>

      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
        className="absolute rounded-full overflow-hidden pointer-events-none"
        style={{ width: 340, height: 340 }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "50%",
            height: "50%",
            transformOrigin: "0% 100%",
            background: "conic-gradient(from 0deg, transparent 0deg, var(--red-glow) 60deg, transparent 60deg)",
            transform: "rotate(-90deg)",
          }}
        />
      </motion.div>

      {[
        { x: 30, y: -80, size: 6, label: "Stackvault Series A" },
        { x: -90, y: 50, size: 5, label: "Orbient Hiring Surge" },
        { x: 100, y: 60, size: 7, label: "Layrlink Tech Match" },
        { x: -30, y: -120, size: 4, label: "VP Sales Hired" },
        { x: 130, y: -20, size: 5, label: "HubSpot CRM" },
      ].map((dot, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0.3, scale: 0.8 }}
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
          transition={{
            duration: 2.2,
            repeat: Infinity,
            delay: i * 0.4,
            ease: "easeInOut",
          }}
          className="absolute rounded-full group cursor-pointer"
          style={{
            width: dot.size,
            height: dot.size,
            background: "var(--red)",
            boxShadow: "0 0 10px var(--red)",
            transform: `translate(${dot.x}px, ${dot.y}px)`,
          }}
        />
      ))}

      <motion.div
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        className="relative z-10 rounded-full flex items-center justify-center cursor-pointer"
        style={{
          width: 80,
          height: 80,
          background: "linear-gradient(135deg, var(--surface), var(--surface-2))",
          border: "1px solid var(--border-red)",
          boxShadow: "0 0 40px var(--red-glow), inset 0 1px 0 var(--glass-highlight)",
        }}
      >
        <span style={{ fontSize: 28 }}>📡</span>
      </motion.div>
    </div>
  );
}

function LiveSignalsFeed() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="w-full max-w-sm rounded-2xl bg-surface/90 border border-subtle p-5 shadow-2xl backdrop-blur-xl space-y-4"
    >
      <div className="flex items-center justify-between border-b border-subtle pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-primary uppercase tracking-wider font-mono">
            Live Buying Intent Feed
          </span>
        </div>
        <span className="text-[10px] text-muted font-mono">Real-time</span>
      </div>

      <div className="space-y-3">
        <motion.div
          whileHover={{ x: 3 }}
          className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-emerald-600 dark:text-emerald-300">💰 $14M Series A Funding</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">96% Fit</span>
          </div>
          <p className="text-xs font-semibold text-primary">Stackvault Corp</p>
          <p className="text-[11px] text-muted">VP of Sales & Founder hiring triggered</p>
        </motion.div>

        <motion.div
          whileHover={{ x: 3 }}
          className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-1 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-indigo-600 dark:text-indigo-300">🔥 Hiring Surge (6 SDRs)</span>
            <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold">92% Fit</span>
          </div>
          <p className="text-xs font-semibold text-primary">Orbient Technologies</p>
          <p className="text-[11px] text-muted">Expanding US outbound sales team</p>
        </motion.div>

        <motion.div
          whileHover={{ x: 3 }}
          className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 space-y-1 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-sky-600 dark:text-sky-300">⚡ Tech Stack Match (HubSpot)</span>
            <span className="text-sky-600 dark:text-sky-400 font-mono font-bold">88% Fit</span>
          </div>
          <p className="text-xs font-semibold text-primary">Layrlink Inc</p>
          <p className="text-[11px] text-muted">Installed Salesforce & HubSpot CRM</p>
        </motion.div>
      </div>
    </motion.div>
  );
}

function ClayWaterfallSpreadsheetDemo() {
  const [activeStep, setActiveStep] = useState(0);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  const steps = [
    { label: "1. Intent Signal", icon: "⚡" },
    { label: "2. Multi-Source Reveal", icon: "🔍" },
    { label: "3. Gemini AI Hook", icon: "🧠" },
    { label: "4. Deliverability", icon: "🛡️" },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const rows = [
    {
      name: "Sarah Chen",
      role: "VP of Engineering",
      company: "Stackvault",
      signal: "💰 $14M Series A",
      email: "sarah@stackvault.io",
      status: "DNS Verified",
      hook: "Saw Stackvault's Series A expansion — scaling AI infra team...",
      source: "Apollo + SERP",
      match: "98%",
    },
    {
      name: "Marcus Vance",
      role: "Head of Growth",
      company: "Orbient",
      signal: "🔥 Hiring 6 SDRs",
      email: "m.vance@orbient.tech",
      status: "MX Validated",
      hook: "Noticed 6 SDR postings at Orbient this week...",
      source: "Gemini AI",
      match: "94%",
    },
    {
      name: "Elena Rostova",
      role: "Chief Revenue Officer",
      company: "Layrlink",
      signal: "⚡ HubSpot Installed",
      email: "elena@layrlink.com",
      status: "Local DB",
      hook: "Congrats on launching Layrlink's new CRM integration...",
      source: "Domain Radar",
      match: "91%",
    },
  ];

  return (
    <div className="w-full rounded-2xl bg-surface/90 border border-subtle shadow-2xl shadow-black/50 overflow-hidden text-xs backdrop-blur-xl transition-all duration-300 hover:border-indigo-500/40">
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-surface-2/80 border-b border-subtle gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
          </div>
          <span className="font-mono font-semibold text-primary ml-2 text-[11px] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>scoutsend_waterfall_table.csv</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto relative">
          {steps.map((s, idx) => (
            <button
              key={s.label}
              onClick={() => setActiveStep(idx)}
              className={`relative px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors z-10 ${
                activeStep === idx ? "text-white font-bold" : "text-secondary hover:text-primary"
              }`}
            >
              {activeStep === idx && (
                <motion.div
                  layoutId="waterfallStepPill"
                  className="absolute inset-0 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/30 -z-10"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-2/60 border-b border-subtle text-[11px] font-semibold text-muted">
              <th className="p-3">PROSPECT</th>
              <th className="p-3">INTENT SIGNAL</th>
              <th className="p-3">WATERFALL REVEAL</th>
              <th className="p-3">AI RESEARCH HOOK</th>
              <th className="p-3">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <motion.tr
                key={i}
                onMouseEnter={() => setHoveredRow(i)}
                onMouseLeave={() => setHoveredRow(null)}
                whileHover={{ backgroundColor: "rgba(99, 102, 241, 0.08)" }}
                className={`border-b border-subtle/60 transition-colors cursor-pointer ${
                  hoveredRow === i ? "bg-indigo-500/10" : ""
                }`}
              >
                <td className="p-3">
                  <div className="font-semibold text-primary flex items-center gap-1.5">
                    <span>{r.name}</span>
                  </div>
                  <div className="text-[10px] text-muted">{r.role} · {r.company}</div>
                </td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-sm">
                    {r.signal}
                  </span>
                </td>
                <td className="p-3 font-mono">
                  <div className="font-medium text-emerald-400 flex items-center gap-1">
                    <span>{r.email}</span>
                  </div>
                  <div className="text-[10px] text-muted flex items-center gap-1">
                    <span>⚡ {r.source}</span>
                    <span className="text-emerald-400 font-bold">({r.match})</span>
                  </div>
                </td>
                <td className="p-3 max-w-[220px]">
                  <p className="truncate text-secondary text-[11px] font-mono">{r.hook}</p>
                </td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {r.status}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("features");

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 pt-4 px-4 pointer-events-none transition-all duration-300">
      <nav
        className={`max-w-6xl mx-auto px-5 py-3 rounded-2xl pointer-events-auto transition-all duration-300 flex items-center justify-between ${
          scrolled
            ? "bg-surface/90 border border-subtle backdrop-blur-2xl shadow-2xl shadow-black/40"
            : "bg-surface/60 border border-subtle/50 backdrop-blur-xl"
        }`}
      >
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform duration-200">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="5" stroke="#fff" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="1.5" fill="#fff" />
              <line x1="12" y1="2" x2="12" y2="7" stroke="#fff" strokeWidth="1.5" />
              <line x1="12" y1="17" x2="12" y2="22" stroke="#fff" strokeWidth="1.5" />
            </svg>
          </div>
          <span className="font-display font-extrabold text-lg tracking-tight text-primary">
            Scout<span className="text-indigo-500">Send</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1 bg-surface-2/70 p-1 rounded-xl border border-subtle/60 relative">
          {[
            { id: "features", label: "Capabilities", href: "#features" },
            { id: "pipeline", label: "AI Pipeline", href: "#pipeline" },
            { id: "playbooks", label: "Playbooks", href: "#playbooks" },
            { id: "deliverability", label: "Deliverability", href: "#deliverability" },
            { id: "pricing", label: "Pricing", href: "#pricing" },
          ].map((item) => (
            <a
              key={item.id}
              href={item.href}
              onClick={() => setActiveSection(item.id)}
              className={`relative px-3.5 py-1.5 rounded-lg text-xs font-semibold font-display transition-colors ${
                activeSection === item.id ? "text-primary font-bold" : "text-muted hover:text-primary"
              }`}
            >
              {activeSection === item.id && (
                <motion.div
                  layoutId="activeNavTab"
                  className="absolute inset-0 bg-surface rounded-lg shadow-sm border border-subtle -z-10"
                  transition={{ type: "spring", stiffness: 380, damping: 28 }}
                />
              )}
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="px-4 py-2 rounded-xl text-xs font-semibold font-display text-secondary hover:text-primary hover:bg-surface-2 transition-all duration-200 hidden sm:inline-flex"
          >
            Sign in
          </Link>
          <MagneticButton
            onClick={() => window.location.href = "/auth/register"}
            className="px-4 py-2 rounded-xl text-xs font-bold font-display text-white bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-500/25 flex items-center gap-1.5 cursor-pointer"
          >
            <span>Start free</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </MagneticButton>
        </div>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section
      className="relative min-h-screen flex items-center overflow-hidden"
      style={{ paddingTop: 80, background: "linear-gradient(160deg, var(--background) 0%, var(--surface) 60%, var(--surface-2) 100%)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent)",
        }}
      />

      <div
        className="absolute pointer-events-none"
        style={{ top: "10%", right: "5%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, var(--red-glow) 0%, transparent 70%)", filter: "blur(40px)" }}
      />
      <div
        className="absolute pointer-events-none"
        style={{ bottom: "0%", left: "0%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)", filter: "blur(60px)" }}
      />

      <div className="max-w-7xl mx-auto px-6 w-full py-12">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          <div>
            <div
              className="inline-flex items-center gap-2 mb-8 animate-fade-up"
              style={{ background: "var(--red-glow)", border: "1px solid var(--border-red)", borderRadius: 100, padding: "6px 14px" }}
            >
              <div className="status-dot" />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--red)", fontFamily: "var(--font-display)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                AI Sales Intelligence & Outbound Engine
              </span>
            </div>

            <h1
              className="animate-fade-up delay-100"
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(40px, 5.5vw, 68px)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--text-primary)", marginBottom: 24 }}
            >
              All-in-one sales intelligence.{" "}
              <br />
              <span className="gradient-text">Powered by AI buying signals.</span>
            </h1>

            <p
              className="animate-fade-up delay-200"
              style={{ fontSize: 18, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 520, marginBottom: 40 }}
            >
              Discover decision makers from 275M+ contacts, reveal emails via cost-optimized waterfall, and trigger personalized AI sequences when intent signals strike.
            </p>

            <div className="flex flex-wrap items-center gap-4 animate-fade-up delay-300">
              <Link
                href="/auth/register"
                className="btn-primary"
                style={{ fontSize: 15, padding: "13px 28px", borderRadius: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                Start free trial →
              </Link>
              <Link
                href="/dashboard/find-leads"
                className="btn-ghost"
                style={{ fontSize: 15, padding: "13px 24px", borderRadius: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <span>Explore Lead Radar</span>
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-6 mt-10 animate-fade-up delay-400">
              {["275M+ verified contacts", "Waterfall email reveal", "SOC 2 compliant"].map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="20,6 9,17 4,12" /></svg>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden lg:flex flex-col gap-4 relative">
            <ClayWaterfallSpreadsheetDemo />
            <div className="flex items-center justify-between text-[11px] text-muted font-mono px-2">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>150+ Data Sources Connected</span>
              </span>
              <span>Waterfall Success Rate: 98.4%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none" style={{ background: "linear-gradient(transparent, var(--navy))" }} />
    </section>
  );
}

function StatsBand() {
  return (
    <div className="stat-band py-12">
      <div className="max-w-7xl mx-auto px-6">
        <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map((s, i) => (
            <StaggerItem key={i}>
              <MotionCard
                enableSpotlight
                className="p-6 rounded-2xl border border-subtle bg-surface text-center cursor-pointer"
              >
                <p
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontSize: 42,
                    color: "var(--text-primary)",
                    letterSpacing: "-0.03em",
                    lineHeight: 1,
                  }}
                >
                  <AnimatedCounter value={s.value} />
                </p>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginTop: 8 }}>
                  {s.label}
                </p>
                {s.sub && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {s.sub}
                  </p>
                )}
              </MotionCard>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </div>
  );
}

function PipelineSection() {
  const [activeStep, setActiveStep] = useState(0);

  const stepDetails = [
    {
      title: "1. Buying Signals Radar",
      desc: "Monitors 150+ web channels for funding rounds, leadership changes, tech stack adoption, and hiring surges in real time.",
      badge: "Real-Time Signal Detection",
      metric: "Over 3,400 signals captured today",
    },
    {
      title: "2. Lead Discovery & TAM Sourcing",
      desc: "Filters 275M+ decision makers by exact job title, seniority level, department size, and tech stack match score.",
      badge: "275M+ B2B Contacts",
      metric: "98.2% Persona Match Precision",
    },
    {
      title: "3. Waterfall Email Reveal",
      desc: "Cascades across local cache, Apollo, SERP web search, Gemini AI syntax prediction, and live MX validation.",
      badge: "Cost-Optimized Cascading",
      metric: "99.4% Valid Email Deliverability",
    },
    {
      title: "4. Signal-Driven AI Copy Engine",
      desc: "Gemini writes hyper-personalized 1-on-1 cold emails referencing specific buying signals rather than generic templates.",
      badge: "Context-Aware Generation",
      metric: "12x Average Reply Rate Lift",
    },
    {
      title: "5. Smart Send & Deliverability Shield",
      desc: "Automated warmup schedules, daily inbox send caps, and instant bounce rate throttling to protect domain health.",
      badge: "Domain Reputation Protection",
      metric: "Zero Domain Blacklistings",
    },
  ];

  const current = stepDetails[activeStep];

  return (
    <section id="pipeline" className="py-[100px]" style={{ background: "var(--surface-2)" }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--red)",
              fontFamily: "var(--font-display)",
              marginBottom: 12,
            }}
          >
            The AI Pipeline
          </p>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "clamp(28px, 4vw, 48px)",
              letterSpacing: "-0.025em",
              color: "var(--text-primary)",
              lineHeight: 1.1,
            }}
          >
            From signal radar to sent email in 5 steps
          </h2>
          <p style={{ fontSize: 16, color: "var(--text-secondary)", marginTop: 16, maxWidth: 520, margin: "16px auto 0" }}>
            ScoutSend coordinates signal discovery, waterfall email verification, and AI copy generation with real-time deliverability shielding.
          </p>
        </div>

        {/* Step Selector Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-10 relative">
          {PIPELINE_STEPS.map((step, i) => (
            <button
              key={i}
              onClick={() => setActiveStep(i)}
              className={`relative p-4 rounded-xl border text-left transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 ${
                activeStep === i ? "border-red shadow-lg" : "bg-surface/60 border-subtle hover:bg-surface"
              }`}
            >
              {activeStep === i && (
                <motion.div
                  layoutId="pipelineActivePill"
                  className="absolute inset-0 bg-surface rounded-xl border border-red shadow-lg -z-10"
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                />
              )}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: `${step.color}18`,
                  border: `1.5px solid ${step.color}50`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  color: step.color,
                }}
              >
                {step.icon}
              </div>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: activeStep === i ? "var(--text-primary)" : "var(--text-secondary)",
                  fontFamily: "var(--font-display)",
                  textAlign: "center",
                }}
              >
                {step.label}
              </p>
            </button>
          ))}
        </div>

        {/* Active Step Details Panel */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStep}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="glow-card p-8 rounded-2xl bg-surface border border-subtle"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">
                {current.badge}
              </span>
              <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                ⚡ {current.metric}
              </span>
            </div>

            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--text-primary)", marginBottom: 12 }}>
              {current.title}
            </h3>
            <p style={{ fontSize: 16, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 680 }}>
              {current.desc}
            </p>
          </motion.div>
        </AnimatePresence>

        <div
          className="mt-12"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "20px 28px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Active Campaign Radar</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              Series A SaaS Sales Expansion Q3
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "Intent Signals", value: "312", color: "#6366f1" },
              { label: "Waterfall Revealed", value: "284", color: "#8b5cf6" },
              { label: "Verified Deliverable", value: "276", color: "var(--success)" },
              { label: "Response Rate", value: "18.4%", color: "var(--red)" },
            ].map((m) => (
              <div key={m.label} style={{ textAlign: "center", padding: "8px 16px", borderRadius: 8, background: `${m.color}10`, border: `1px solid ${m.color}25` }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: m.color, fontFamily: "var(--font-display)", lineHeight: 1 }}>{m.value}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{m.label}</p>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "8px 14px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#22c55e" }}>Live Radar Active</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="py-[100px]" style={{ background: "var(--background)" }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 12 }}>
            Capabilities
          </p>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(28px, 4vw, 48px)", letterSpacing: "-0.025em", color: "var(--text-primary)", lineHeight: 1.1 }}>
            Everything you need for <em style={{ fontStyle: "italic", color: "var(--red)" }}>modern B2B outbound</em>
          </h2>
        </div>

        <StaggerContainer className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <StaggerItem key={i}>
              <MotionCard
                enableSpotlight
                className="glow-card h-full"
                style={{
                  padding: 28,
                  borderRadius: 16,
                  border: f.accent ? "1px solid var(--border-red)" : "1px solid var(--border)",
                  background: f.accent ? "linear-gradient(135deg, var(--red-glow), var(--surface))" : "var(--surface)",
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <span style={{ fontSize: 22 }}>{f.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: f.accent ? "var(--red)" : "var(--text-muted)", fontFamily: "var(--font-display)" }}>
                    {f.tag}
                  </span>
                </div>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-primary)", marginBottom: 10, letterSpacing: "-0.01em" }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                  {f.desc}
                </p>
              </MotionCard>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

function DomainSection() {
  const domains = [
    { name: "scoutsend.ai", health: "HEALTHY", score: 99, sent: 42, limit: 50, bounce: "0.4%", color: "#10b981" },
    { name: "outbound.io", health: "HEALTHY", score: 94, sent: 36, limit: 50, bounce: "0.9%", color: "#10b981" },
    { name: "signalreach.co", health: "WARNING", score: 76, sent: 48, limit: 50, bounce: "4.2%", color: "#f59e0b" },
    { name: "salesmail.ai", health: "DEGRADED", score: 54, sent: 12, limit: 25, bounce: "8.8%", color: "#ef4444" },
  ];

  return (
    <section id="deliverability" className="py-[100px]" style={{ background: "var(--surface-2)" }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 12 }}>
              Deliverability First
            </p>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(28px, 3.5vw, 44px)", letterSpacing: "-0.025em", color: "var(--text-primary)", lineHeight: 1.1, marginBottom: 20 }}>
              Sender reputation protection built in by default
            </h2>
            <p style={{ fontSize: 16, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 32 }}>
              ScoutSend monitors sender domain health and DNS MX deliverability in real-time. Automatic throttling kicks in before high bounce rates damage your inbox placement.
            </p>
            <div className="flex flex-col gap-4">
              {DOMAIN_SECTION_BULLETS.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span style={{ fontSize: 18, marginTop: 2 }}>{item.icon}</span>
                  <p style={{ fontSize: 15, color: "var(--text-secondary)" }}>{item.text}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, overflow: "hidden", boxShadow: "var(--glass-shadow-hover)" }}>
              <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>Sender Domain Health Monitor</p>
                <p style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>● Active</p>
              </div>
              {domains.map((d, i) => (
                <div
                  key={i}
                  style={{ padding: "16px 24px", borderBottom: i < domains.length - 1 ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: 12 }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${d.color}`, display: "flex", alignItems: "center", justifyContent: "center", background: `${d.color}12`, flexShrink: 0 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: d.color, boxShadow: `0 0 6px ${d.color}` }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2">
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{d.name}</p>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, background: `${d.color}18`, color: d.color, border: `1px solid ${d.color}30` }}>{d.health}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ width: `${(d.sent / d.limit) * 100}%`, height: "100%", background: d.color, borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{d.sent}/{d.limit} sent</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontSize: 20, fontWeight: 800, color: d.color, fontFamily: "var(--font-display)", lineHeight: 1 }}>{d.score}</p>
                    <p style={{ fontSize: 10, color: "var(--text-muted)" }}>rep score</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  return (
    <section className="py-[100px]" style={{ background: "var(--background)" }}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 12 }}>
            Customer Results
          </p>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(28px, 4vw, 48px)", letterSpacing: "-0.025em", color: "var(--text-primary)", lineHeight: 1.1 }}>
            Trusted by fast-growing B2B sales teams
          </h2>
        </motion.div>

        <StaggerContainer className="grid md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t, i) => (
            <StaggerItem key={i}>
              <MotionCard
                enableSpotlight
                className="glow-card h-full"
                style={{ padding: 32, borderRadius: 16 }}
              >
                <div style={{ fontSize: 48, lineHeight: 1, color: "var(--red)", fontFamily: "Georgia, serif", opacity: 0.6, marginBottom: 8 }}>"</div>
                <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 24 }}>{t.quote}</p>
                <div className="flex items-center gap-3">
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, var(--red), var(--accent))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>
                    {t.initials}
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{t.name}</p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.role} · {t.company}</p>
                  </div>
                </div>
              </MotionCard>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

function IntegrationsGrid() {
  const integrations = [
    { name: "Apollo.io", desc: "Multi-page B2B contact reveal", icon: <Database className="w-6 h-6 text-indigo-500" /> },
    { name: "Google SERP & Places", desc: "Real-time web & local company search", icon: <Globe className="w-6 h-6 text-sky-500" /> },
    { name: "Google Gemini AI", desc: "Agentic research & personalised copy", icon: <Sparkles className="w-6 h-6 text-amber-500" /> },
    { name: "Unipile LinkedIn", desc: "Automated multi-touch LinkedIn messaging", icon: <LinkedinIcon className="w-6 h-6 text-blue-600" /> },
    { name: "Outlook & Gmail", desc: "OAuth 2.0 mailbox sync & rotation", icon: <Mail className="w-6 h-6 text-rose-500" /> },
    { name: "HubSpot & Salesforce", desc: "Bidirectional CRM lead & log sync", icon: <RefreshCw className="w-6 h-6 text-emerald-500" /> },
  ];

  return (
    <section className="py-[80px]" style={{ background: "var(--background)" }}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-red font-display mb-2">
            Ecosystem Integrations
          </p>
          <h2 className="font-display font-extrabold text-3xl md:text-4xl text-primary">
            Powered by the top GTM & AI providers
          </h2>
          <p className="text-secondary mt-3 max-w-xl mx-auto text-sm">
            ScoutSend natively connects data providers, AI engines, email mailboxes, and CRMs into a single automated pipeline.
          </p>
        </motion.div>

        <StaggerContainer className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {integrations.map((item, idx) => (
            <StaggerItem key={idx}>
              <MotionCard
                enableSpotlight
                className="glow-card p-5 rounded-2xl bg-surface border border-subtle text-center flex flex-col items-center justify-center gap-2 hover:border-red/40 cursor-pointer h-full"
              >
                <div className="p-2.5 rounded-xl bg-surface-2 border border-subtle mb-1">
                  {item.icon}
                </div>
                <p className="font-display font-bold text-xs text-primary">{item.name}</p>
                <p className="text-[10px] text-muted leading-tight">{item.desc}</p>
              </MotionCard>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

function GtmPlaybooksSection() {
  const [activePlaybook, setActivePlaybook] = useState(0);

  const playbooks = [
    {
      title: "Playbook 1: Series A Funding Spike",
      trigger: "💰 Target company closes $10M+ funding round",
      result: "18.4% Reply Rate · 4.2x Meeting Conversion",
      sampleSubject: "Congrats on the Series A, {{firstName}} — scaling engineering at {{company}}?",
      sampleBody: "Hi {{firstName}},\n\nSaw {{company}}'s recent Series A announcement — congrats on the milestone! As you scale up your engineering team this quarter, I wanted to share how we helped Stackvault accelerate SDR onboarding by 3x...\n\nBest,",
    },
    {
      title: "Playbook 2: Sales Team Hiring Spurt",
      trigger: "🔥 Target company posts 3+ SDR/AE job listings",
      result: "22.1% Reply Rate · 6 Enterprise Deals Closed",
      sampleSubject: "Scaling the SDR team at {{company}}?",
      sampleBody: "Hi {{firstName}},\n\nNoticed {{company}} is actively hiring 4 SDRs this week. Most SDR teams spend 40% of their time manually researching leads and fighting spam filters. ScoutSend automates the entire waterfall reveal and mailbox warmup...\n\nBest,",
    },
    {
      title: "Playbook 3: CRM Tech Stack Migration",
      trigger: "⚡ Target company installs HubSpot or Salesforce",
      result: "15.8% Reply Rate · 99.4% Inbox Placement",
      sampleSubject: "Quick question about {{company}}'s CRM workflow",
      sampleBody: "Hi {{firstName}},\n\nSaw that {{company}} recently integrated HubSpot for GTM operations. ScoutSend automatically syncs all verified waterfall leads and AI outreach logs back into your CRM in real time...\n\nBest,",
    },
  ];

  const current = playbooks[activePlaybook];

  return (
    <section className="py-[100px]" style={{ background: "var(--surface-2)" }}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-red font-display mb-2">
            Automated GTM Playbooks
          </p>
          <h2 className="font-display font-extrabold text-3xl md:text-4xl text-primary">
            Turn Intent Signals into High-Converting Outreach
          </h2>
          <p className="text-secondary mt-3 max-w-xl mx-auto text-sm">
            Deploy pre-built AI playbooks that trigger personalized email sequences the moment market buying signals fire.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-4 mb-8 relative">
          {playbooks.map((pb, idx) => (
            <button
              key={idx}
              onClick={() => setActivePlaybook(idx)}
              className={`relative p-5 rounded-2xl border text-left transition-colors cursor-pointer ${
                activePlaybook === idx ? "border-red shadow-lg" : "bg-surface/60 border-subtle hover:bg-surface"
              }`}
            >
              {activePlaybook === idx && (
                <motion.div
                  layoutId="playbookActivePill"
                  className="absolute inset-0 bg-surface rounded-2xl border border-red shadow-lg -z-10"
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                />
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 mb-3">
                {pb.trigger}
              </span>
              <h3 className="font-display font-bold text-base text-primary mb-1">
                {pb.title}
              </h3>
              <p className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                ⚡ {pb.result}
              </p>
            </button>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="glow-card p-6 md:p-8 rounded-2xl bg-surface border border-subtle space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-4">
            <div>
              <p className="text-xs text-muted font-mono">ACTIVE PLAYBOOK TEMPLATE</p>
              <h4 className="font-display font-bold text-lg text-primary">{current.title}</h4>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {current.result}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-bold text-muted uppercase font-mono mb-1">Generated Subject Line</p>
              <p className="font-mono text-xs font-semibold text-primary bg-surface-2 p-2.5 rounded-lg border border-subtle">
                {current.sampleSubject}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold text-muted uppercase font-mono mb-1">Gemini AI Email Body</p>
              <div className="font-mono text-xs text-secondary bg-surface-2 p-3.5 rounded-lg border border-subtle whitespace-pre-line leading-relaxed">
                {current.sampleBody}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section id="pricing" className="py-[100px]" style={{ background: "var(--surface-2)" }}>
      <div className="max-w-4xl mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          style={{
            background: "linear-gradient(135deg, var(--surface) 0%, var(--red-glow) 100%)",
            border: "1px solid var(--border-red)",
            borderRadius: 24,
            padding: "72px 48px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", top: -60, right: -60, width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, var(--red-glow), transparent)", filter: "blur(40px)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -60, left: -60, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, var(--accent-glow), transparent)", filter: "blur(40px)", pointerEvents: "none" }} />

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 16 }}>
            Get Started Today
          </p>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(30px, 4.5vw, 54px)", letterSpacing: "-0.03em", color: "var(--text-primary)", lineHeight: 1.05, marginBottom: 20 }}>
            Supercharge your B2B sales pipeline.
          </h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 480, margin: "0 auto 40px" }}>
            Explore 275M+ decision makers, run waterfall email reveals, and trigger signal-based AI campaigns in under 5 minutes.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <MagneticButton
              onClick={() => window.location.href = "/auth/register"}
              className="btn-primary"
              style={{ fontSize: 16, padding: "15px 36px", borderRadius: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}
            >
              <span>Start for free</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </MagneticButton>
            <Link
              href="/dashboard/find-leads"
              className="btn-ghost"
              style={{ fontSize: 16, padding: "15px 28px", borderRadius: 12, textDecoration: "none" }}
            >
              Explore Lead Radar
            </Link>
          </div>

          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 24 }}>
            Free plan includes 100 leads & 3 campaigns. No credit card required.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    {
      heading: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "Pipeline", href: "#pipeline" },
        { label: "Deliverability", href: "#deliverability" },
        { label: "Pricing", href: "#pricing" },
        { label: "Lead Discovery", href: "/dashboard/find-leads" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Blog", href: "/blog" },
        { label: "Careers", href: "/careers" },
        { label: "Press", href: "/press" },
        { label: "Legal", href: "/legal" },
      ],
    },
    {
      heading: "Resources",
      links: [
        { label: "Documentation", href: "/docs" },
        { label: "API Reference", href: "/docs/api" },
        { label: "Status", href: "https://status.scoutsend.io" },
        { label: "Community", href: "/community" },
        { label: "Support", href: "/support" },
      ],
    },
  ];

  return (
    <footer style={{ background: "var(--background)", borderTop: "1px solid var(--border)", padding: "64px 0 40px" }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--red)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="1.5" /><circle cx="12" cy="12" r="5" stroke="#fff" strokeWidth="1.5" /><circle cx="12" cy="12" r="1.5" fill="#fff" /></svg>
              </div>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>
                Scout<span style={{ color: "var(--red)" }}>Send</span>
              </span>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
              AI-powered sales intelligence & outbound engine that researches, reveals, and sends with precision.
            </p>
          </div>

          {cols.map((col) => (
            <div key={col.heading}>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-primary)", marginBottom: 16, fontFamily: "var(--font-display)" }}>
                {col.heading}
              </p>
              <div className="flex flex-col gap-3">
                {col.links.map(({ label, href }) => (
                  <Link
                    key={label}
                    href={href}
                    style={{ fontSize: 14, color: "var(--text-muted)", textDecoration: "none", transition: "color 0.2s" }}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 28, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>© 2026 ScoutSend. All rights reserved.</p>
          <div className="flex items-center gap-2">
            <div className="status-dot" style={{ width: 6, height: 6 }} />
            <p style={{ fontSize: 13, color: "#22c55e" }}>All systems operational</p>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <main className="noise">
      <Nav />
      <Hero />
      <StatsBand />
      <PipelineSection />
      <FeaturesSection />
      <GtmPlaybooksSection />
      <IntegrationsGrid />
      <DomainSection />
      <TestimonialsSection />
      <CTASection />
      <Footer />
    </main>
  );
}