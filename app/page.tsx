"use client";

import { useEffect, useState } from "react";

/* ─── Types ──────────────────────────────────────────────────────────────────── */
interface StatItem { value: string; label: string; sub?: string }
interface FeatureCard { icon: string; tag: string; title: string; desc: string; accent?: boolean }
interface TestimonialItem { quote: string; name: string; role: string; company: string; initials: string }

/* ─── Data ───────────────────────────────────────────────────────────────────── */
const STATS: StatItem[] = [
  { value: "4.2M", label: "Emails Delivered", sub: "last 30 days" },
  { value: "38%", label: "Average Open Rate", sub: "vs 21% industry" },
  { value: "12×", label: "Reply Rate Lift", sub: "over cold lists" },
  { value: "99.7%", label: "Deliverability", sub: "across all domains" },
];

const FEATURES: FeatureCard[] = [
  {
    icon: "🔭",
    tag: "Phase 1",
    title: "AI Research Agent",
    desc: "Scours the web, LinkedIn, and company signals to qualify every lead with a confidence score before your campaign touches them.",
  },
  {
    icon: "✍️",
    tag: "Phase 2",
    title: "Hyper-Personalised Generation",
    desc: "Gemini writes each email referencing real signals — recent funding, job posts, tech stack — not mail-merge tokens.",
    accent: true,
  },
  {
    icon: "🛡️",
    tag: "Phase 3",
    title: "Spam & Quality Review",
    desc: "Every message scores for spam risk and personalisation quality. Risky emails are held for human review before a single send.",
  },
  {
    icon: "📬",
    tag: "Phase 4",
    title: "Throttled Smart Send",
    desc: "Domain-aware sending respects daily limits, warmup schedules, and bounce thresholds to protect your sender reputation.",
  },
  {
    icon: "🧠",
    tag: "Learning Loop",
    title: "Self-Improving AI",
    desc: "Every approval, edit, and rejection trains the model. ScoutSend gets smarter with every campaign your team runs.",
  },
  {
    icon: "📊",
    tag: "Deliverability",
    title: "Domain Health Monitoring",
    desc: "Real-time bounce rates, complaint scores, and reputation health across all sender domains — with automatic throttling.",
  },
];

const DOMAIN_SECTION_BULLETS = [
  { icon: "⚡", text: "Automatic warmup schedules for new domains" },
  { icon: "🛑", text: "Hard stops at bounce > 10% or complaint > 0.5%" },
  { icon: "📈", text: "Reputation score tracked across every campaign" },
];

const PIPELINE_STEPS = [
  { label: "Research", color: "#6366f1", icon: "◎" },
  { label: "Generate", color: "#8b5cf6", icon: "⊕" },
  { label: "Review", color: "#e94560", icon: "◈" },
  { label: "Queue", color: "#f59e0b", icon: "⊛" },
  { label: "Send", color: "#22c55e", icon: "◉" },
];

const TESTIMONIALS: TestimonialItem[] = [
  {
    quote: "We closed 3 enterprise deals in the first campaign. The AI found signals our SDRs would have missed completely.",
    name: "Amara Nwosu",
    role: "Head of Sales",
    company: "Stackvault",
    initials: "AN",
  },
  {
    quote: "The domain warmup and deliverability controls are the only reason we haven't burnt our sending domains. Genuinely lifesaving.",
    name: "Priya Mehta",
    role: "Growth Lead",
    company: "Orbient",
    initials: "PM",
  },
  {
    quote: "Our reply rate went from 1.4% to 17% in 6 weeks. The personalisation is so good that prospects think we researched them manually.",
    name: "Tobias Kern",
    role: "Founder",
    company: "Layrlink",
    initials: "TK",
  },
];

/* ─── Radar SVG Component ────────────────────────────────────────────────────── */
function RadarOrb() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: "min(420px, 100%)", height: "min(420px, 100%)" }}>
      {/* Outer ping rings */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="absolute rounded-full border"
          style={{
            width: `${100 + i * 80}px`,
            height: `${100 + i * 80}px`,
            borderColor: `rgba(233,69,96,${0.12 - i * 0.03})`,
            animation: `radar-ping ${2 + i * 0.8}s ease-out ${i * 0.4}s infinite`,
          }}
        />
      ))}

      {/* Static rings */}
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

      {/* Cross-hairs */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.04)" }} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div style={{ width: 1, height: "100%", background: "rgba(255,255,255,0.04)" }} />
      </div>

      {/* Spinning sweep */}
      <div
        className="absolute rounded-full overflow-hidden"
        style={{ width: 340, height: 340, animation: "radar-spin 6s linear infinite" }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "50%",
            height: "50%",
            transformOrigin: "0% 100%",
            background: "conic-gradient(from 0deg, transparent 0deg, rgba(233,69,96,0.35) 60deg, transparent 60deg)",
            transform: "rotate(-90deg)",
          }}
        />
      </div>

      {/* Lead dots */}
      {[
        { x: 30, y: -80, delay: "0s", size: 5 },
        { x: -90, y: 50, delay: "0.6s", size: 4 },
        { x: 100, y: 60, delay: "1.2s", size: 6 },
        { x: -30, y: -120, delay: "0.3s", size: 3 },
        { x: 130, y: -20, delay: "1.8s", size: 4 },
        { x: -110, y: -40, delay: "0.9s", size: 5 },
        { x: 60, y: 130, delay: "1.5s", size: 3 },
      ].map((dot, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: dot.size,
            height: dot.size,
            background: "#e94560",
            boxShadow: "0 0 8px #e94560",
            transform: `translate(${dot.x}px, ${dot.y}px)`,
            animation: `fade-in 0.3s ease ${dot.delay} both, pulse-red 2s ${dot.delay} ease-in-out infinite`,
          }}
        />
      ))}

      {/* Centre core */}
      <div
        className="relative z-10 rounded-full flex items-center justify-center"
        style={{
          width: 80,
          height: 80,
          background: "linear-gradient(135deg, #1e2340, #252b4a)",
          border: "1px solid rgba(233,69,96,0.4)",
          boxShadow: "0 0 40px rgba(233,69,96,0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <span style={{ fontSize: 28 }}>⊕</span>
      </div>
    </div>
  );
}

/* ─── Floating Email Preview ─────────────────────────────────────────────────── */
function EmailPreviewCard() {
  return (
    <div
      className="animate-float"
      style={{
        background: "var(--surface)",
        border: "1px solid rgba(233,69,96,0.2)",
        borderRadius: 16,
        padding: "20px 24px",
        maxWidth: 320,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
        animationDelay: "1s",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#e94560,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>S</div>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>ScoutSend AI</p>
          <p style={{ fontSize: 10, color: "var(--text-secondary)" }}>scout@acmecorp.io</p>
        </div>
        <div className="ml-auto" style={{ fontSize: 10, color: "var(--text-muted)" }}>Just now</div>
      </div>

      {/* Subject */}
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
        Re: Stackvault's Series B — congrats on the close
      </p>

      {/* Body */}
      <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        Hi Amara, saw the announcement yesterday — impressive raise. Given Stackvault is now scaling infra, I wanted to reach out about how we help post-Series B sales teams…
      </p>

      {/* Scores */}
      <div className="flex gap-3 mt-4">
        <div style={{ flex: 1, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "6px 10px" }}>
          <p style={{ fontSize: 10, color: "#22c55e", fontWeight: 600 }}>Personalisation</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#22c55e", fontFamily: "var(--font-display)" }}>94</p>
        </div>
        <div style={{ flex: 1, background: "rgba(233,69,96,0.06)", border: "1px solid rgba(233,69,96,0.15)", borderRadius: 8, padding: "6px 10px" }}>
          <p style={{ fontSize: 10, color: "#e94560", fontWeight: 600 }}>Spam Risk</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#e94560", fontFamily: "var(--font-display)" }}>2</p>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mt-3">
        {["Series B signal", "Hiring spike", "Tech match"].map((t) => (
          <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/* ─── Scroll Reveal Hook ─────────────────────────────────────────────────────── */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).classList.add("visible"); } }),
      { threshold: 0.15 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

/* ─── Nav ────────────────────────────────────────────────────────────────────── */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{ background: scrolled ? "rgba(26,26,46,0.92)" : "transparent", backdropFilter: scrolled ? "blur(20px)" : "none", borderBottom: scrolled ? "1px solid var(--border)" : "none" }}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--red)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px var(--red-glow)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="5" stroke="#fff" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="1.5" fill="#fff" />
              <line x1="12" y1="2" x2="12" y2="7" stroke="#fff" strokeWidth="1.5" />
              <line x1="12" y1="17" x2="12" y2="22" stroke="#fff" strokeWidth="1.5" />
            </svg>
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Scout<span style={{ color: "var(--red)" }}>Send</span>
          </span>
        </div>

        {/* Links */}
        <div className="hidden md:flex items-center gap-8">
          {["Features", "How It Works", "Pricing", "Docs"].map((link, i) => {
            const anchors = ["#features", "#pipeline", "#pricing", "#docs"];
            return (
              <a key={link} href={anchors[i]} style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 500, textDecoration: "none", transition: "color 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
              >{link}</a>
            );
          })}
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <a href="/auth/login" className="btn-ghost hidden md:inline-flex" style={{ fontSize: 14, padding: "8px 18px", borderRadius: 8, textDecoration: "none" }}>
            Sign in
          </a>
          <a href="/auth/register" className="btn-primary" style={{ fontSize: 14, padding: "8px 20px", borderRadius: 8, textDecoration: "none" }}>
            Start free →
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section
      className="relative min-h-screen flex items-center overflow-hidden"
      style={{ paddingTop: 80, background: "linear-gradient(160deg, var(--navy) 0%, var(--navy-mid) 60%, #0d1a3a 100%)" }}
    >
      {/* Background grid */}
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

      {/* Red gradient blob */}
      <div
        className="absolute pointer-events-none"
        style={{ top: "10%", right: "5%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(233,69,96,0.12) 0%, transparent 70%)", filter: "blur(40px)" }}
      />
      <div
        className="absolute pointer-events-none"
        style={{ bottom: "0%", left: "0%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)", filter: "blur(60px)" }}
      />

      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* Left — copy */}
          <div>
            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 mb-8 animate-fade-up"
              style={{ background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.25)", borderRadius: 100, padding: "6px 14px" }}
            >
              <div className="status-dot" />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--red)", fontFamily: "var(--font-display)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                AI Outbound Engine
              </span>
            </div>

            {/* Headline */}
            <h1
              className="animate-fade-up delay-100"
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(40px, 5.5vw, 68px)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--text-primary)", marginBottom: 24 }}
            >
              Scout every lead.{" "}
              <br />
              <span className="gradient-text">Send with precision.</span>
            </h1>

            {/* Sub */}
            <p
              className="animate-fade-up delay-200"
              style={{ fontSize: 18, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 500, marginBottom: 40 }}
            >
              ScoutSend's AI pipeline researches, writes, reviews, and sends hyper-personalised cold emails — protecting your domain reputation at every step.
            </p>

            {/* CTA row */}
            <div className="flex flex-wrap items-center gap-4 animate-fade-up delay-300">
              <a
                href="/auth/register"
                className="btn-primary"
                style={{ fontSize: 15, padding: "13px 28px", borderRadius: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                Launch your first campaign
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </a>
              <a
                href="#"
                className="btn-ghost"
                style={{ fontSize: 15, padding: "13px 24px", borderRadius: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polygon points="10,8 16,12 10,16" /></svg>
                Watch demo
              </a>
            </div>

            {/* Trust row */}
            <div className="flex flex-wrap items-center gap-6 mt-10 animate-fade-up delay-400">
              {["No credit card", "5-min setup", "SOC 2 compliant"].map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="20,6 9,17 4,12" /></svg>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — radar + email card */}
          <div className="hidden lg:flex items-center justify-center relative" style={{ minHeight: 420 }}>
            <RadarOrb />
            <div className="absolute" style={{ bottom: 0, right: -20 }}>
              <EmailPreviewCard />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none" style={{ background: "linear-gradient(transparent, var(--navy))" }} />
    </section>
  );
}

/* ─── Stats Band ─────────────────────────────────────────────────────────────── */
function StatsBand() {
  return (
    <div className="stat-band">
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map((s, i) => (
            <div key={i} className="text-center reveal" style={{ transitionDelay: `${i * 0.1}s` }}>
              <p style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 40, color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1 }}>
                {s.value}
              </p>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginTop: 4 }}>{s.label}</p>
              {s.sub && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Pipeline Section ───────────────────────────────────────────────────────── */
function PipelineSection() {
  return (
    <section id="pipeline" className="py-[100px] bg-navy-mid">
      <div className="max-w-7xl mx-auto px-6">

        <div className="text-center mb-16 reveal">
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 12 }}>
            The Pipeline
          </p>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(28px, 4vw, 48px)", letterSpacing: "-0.025em", color: "var(--text-primary)", lineHeight: 1.1 }}>
            Four AI phases. Zero guesswork.
          </h2>
          <p style={{ fontSize: 16, color: "var(--text-secondary)", marginTop: 16, maxWidth: 520, margin: "16px auto 0" }}>
            ScoutSend runs a sequential agentic pipeline from first signal to sent email — with human review gates at every risky step.
          </p>
        </div>

        {/* Pipeline steps */}
        <div className="grid grid-cols-3 sm:flex sm:items-start sm:justify-center gap-4 sm:gap-0 overflow-x-auto pb-4 reveal">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={i} className="pipeline-step relative flex flex-col items-center gap-2" style={{ minWidth: 80, flex: 1 }}>
              {/* Node */}
              <div
                style={{
                  width: 44, height: 44,
                  borderRadius: "50%",
                  background: `${step.color}18`,
                  border: `1.5px solid ${step.color}50`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, color: step.color,
                  boxShadow: `0 0 20px ${step.color}30`,
                }}
              >
                {step.icon}
              </div>
              {/* Label */}
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-display)", textAlign: "center" }}>
                {step.label}
              </p>
              {/* Connector line is in CSS ::after */}
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className="hidden sm:block"
                  style={{
                    position: "absolute",
                    top: 22, left: "calc(50% + 22px)",
                    width: "calc(100% - 44px)", height: 1,
                    background: `linear-gradient(90deg, ${step.color}60, ${PIPELINE_STEPS[i + 1].color}40)`,
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Campaign status strip */}
        <div
          className="mt-12 reveal"
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
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Active Campaign</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              SaaS Series B Outbound Q2
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "Leads Researched", value: "247", color: "#6366f1" },
              { label: "Emails Generated", value: "231", color: "#8b5cf6" },
              { label: "Pending Review", value: "14", color: "#e94560" },
              { label: "Sent Today", value: "25", color: "#22c55e" },
            ].map((m) => (
              <div key={m.label} style={{ textAlign: "center", padding: "8px 16px", borderRadius: 8, background: `${m.color}10`, border: `1px solid ${m.color}25` }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: m.color, fontFamily: "var(--font-display)", lineHeight: 1 }}>{m.value}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{m.label}</p>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "8px 14px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#22c55e" }}>Sending</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Features Bento Grid ────────────────────────────────────────────────────── */
function FeaturesSection() {
  return (
    <section id="features" className="py-[100px] bg-navy">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 reveal">
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 12 }}>
            Features
          </p>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(28px, 4vw, 48px)", letterSpacing: "-0.025em", color: "var(--text-primary)", lineHeight: 1.1 }}>
            Built for outbound that <em style={{ fontStyle: "italic", color: "var(--red)" }}>actually lands</em>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="feature-card glow-card reveal"
              style={{
                padding: 28,
                transitionDelay: `${i * 0.08}s`,
                border: f.accent ? "1px solid rgba(233,69,96,0.3)" : "1px solid var(--border)",
                background: f.accent ? "linear-gradient(135deg, rgba(233,69,96,0.06), var(--surface))" : "var(--surface)",
              }}
            >
              {/* Tag */}
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
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Domain Health Visual ───────────────────────────────────────────────────── */
function DomainSection() {
  const domains = [
    { name: "scout.io", health: "HEALTHY", score: 98, sent: 24, limit: 50, bounce: "0.8%", color: "#22c55e" },
    { name: "outreach.co", health: "HEALTHY", score: 91, sent: 38, limit: 50, bounce: "1.2%", color: "#22c55e" },
    { name: "signal.co", health: "WARNING", score: 74, sent: 50, limit: 50, bounce: "4.9%", color: "#f59e0b" },
    { name: "reach.ai", health: "DEGRADED", score: 52, sent: 12, limit: 25, bounce: "9.3%", color: "#e94560" },
  ];

  return (
    <section className="py-[100px] bg-navy-mid">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="reveal">
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 12 }}>
              Deliverability First
            </p>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(28px, 3.5vw, 44px)", letterSpacing: "-0.025em", color: "var(--text-primary)", lineHeight: 1.1, marginBottom: 20 }}>
              Your sending reputation is sacred. We treat it that way.
            </h2>
            <p style={{ fontSize: 16, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 32 }}>
              ScoutSend monitors every domain in real time. The moment bounce rates or complaint scores edge toward dangerous thresholds, sending automatically throttles — before you hit a blacklist.
            </p>
            <div className="flex flex-col gap-4">
              {DOMAIN_SECTION_BULLETS.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span style={{ fontSize: 18, marginTop: 2 }}>{item.icon}</span>
                  <p style={{ fontSize: 15, color: "var(--text-secondary)" }}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="reveal delay-200">
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}>
              {/* Header */}
              <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>Sender Domain Health</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Live</p>
              </div>
              {/* Domain rows */}
              {domains.map((d, i) => (
                <div
                  key={i}
                  style={{ padding: "16px 24px", borderBottom: i < domains.length - 1 ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: 12 }}
                >
                  {/* Health ring */}
                  <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${d.color}`, display: "flex", alignItems: "center", justifyContent: "center", background: `${d.color}12`, flexShrink: 0 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: d.color, boxShadow: `0 0 6px ${d.color}` }} />
                  </div>
                  {/* Name + status */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2">
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{d.name}</p>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, background: `${d.color}18`, color: d.color, border: `1px solid ${d.color}30` }}>{d.health}</span>
                    </div>
                    {/* Send progress */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div style={{ width: `${(d.sent / d.limit) * 100}%`, height: "100%", background: d.color, borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{d.sent}/{d.limit} sent</span>
                    </div>
                  </div>
                  {/* Score */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontSize: 20, fontWeight: 800, color: d.color, fontFamily: "var(--font-display)", lineHeight: 1 }}>{d.score}</p>
                    <p style={{ fontSize: 10, color: "var(--text-muted)" }}>rep score</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Testimonials ───────────────────────────────────────────────────────────── */
function TestimonialsSection() {
  return (
    <section className="py-[100px] bg-navy">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 reveal">
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 12 }}>
            Social Proof
          </p>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(28px, 4vw, 48px)", letterSpacing: "-0.025em", color: "var(--text-primary)", lineHeight: 1.1 }}>
            Teams hitting quota faster
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="feature-card glow-card reveal"
              style={{ padding: 32, transitionDelay: `${i * 0.1}s` }}
            >
              {/* Quote mark */}
              <div style={{ fontSize: 48, lineHeight: 1, color: "var(--red)", fontFamily: "Georgia, serif", opacity: 0.6, marginBottom: 8 }}>"</div>
              <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 24 }}>{t.quote}</p>
              <div className="flex items-center gap-3">
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, var(--red), #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>
                  {t.initials}
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{t.name}</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.role} · {t.company}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CTA Section ────────────────────────────────────────────────────────────── */
function CTASection() {
  return (
    <section className="py-[100px] bg-navy-mid">
      <div className="max-w-4xl mx-auto px-6 text-center reveal">
        <div
          style={{
            background: "linear-gradient(135deg, var(--surface) 0%, rgba(233,69,96,0.06) 100%)",
            border: "1px solid rgba(233,69,96,0.2)",
            borderRadius: 24,
            padding: "72px 48px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Glow blobs */}
          <div style={{ position: "absolute", top: -60, right: -60, width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, rgba(233,69,96,0.15), transparent)", filter: "blur(40px)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -60, left: -60, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.1), transparent)", filter: "blur(40px)", pointerEvents: "none" }} />

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)", fontFamily: "var(--font-display)", marginBottom: 16 }}>
            Get started today
          </p>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(30px, 4.5vw, 54px)", letterSpacing: "-0.03em", color: "var(--text-primary)", lineHeight: 1.05, marginBottom: 20 }}>
            Your pipeline isn't going to fill itself.
          </h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 480, margin: "0 auto 40px" }}>
            Launch your first AI-powered campaign in under 5 minutes. No SDR required.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="/auth/register"
              className="btn-primary animate-pulse-red"
              style={{ fontSize: 16, padding: "15px 36px", borderRadius: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 10 }}
            >
              Start for free
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </a>
            <a
              href="#"
              className="btn-ghost"
              style={{ fontSize: 16, padding: "15px 28px", borderRadius: 12, textDecoration: "none" }}
            >
              Book a demo
            </a>
          </div>

          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 24 }}>
            Free plan includes 100 leads & 3 campaigns. No credit card.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────────────── */
function Footer() {
  const cols = [
    {
      heading: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "Pipeline", href: "#pipeline" },
        { label: "Deliverability", href: "#deliverability" },
        { label: "Pricing", href: "#pricing" },
        { label: "Changelog", href: "/changelog" },
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
    <footer style={{ background: "var(--navy)", borderTop: "1px solid var(--border)", padding: "64px 0 40px" }}>
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
              AI-powered outbound that researches, writes, and sends with precision.
            </p>
          </div>

          {cols.map((col) => (
            <div key={col.heading}>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-primary)", marginBottom: 16, fontFamily: "var(--font-display)" }}>
                {col.heading}
              </p>
              <div className="flex flex-col gap-3">
                {col.links.map(({ label, href }) => (
                  <a
                    key={label}
                    href={href}
                    style={{ fontSize: 14, color: "var(--text-muted)", textDecoration: "none", transition: "color 0.2s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                  >
                    {label}
                  </a>
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

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function Home() {
  useReveal();

  return (
    <main className="noise">
      <Nav />
      <Hero />
      <StatsBand />
      <PipelineSection />
      <FeaturesSection />
      <DomainSection />
      <TestimonialsSection />
      <CTASection />
      <Footer />
    </main>
  );
}