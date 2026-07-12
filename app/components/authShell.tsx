"use client";

function RadarOrb() {
    const dots = [
        { top: "28%", left: "65%", size: 5, delay: "0s" },
        { top: "60%", left: "25%", size: 4, delay: "0.4s" },
        { top: "70%", left: "68%", size: 6, delay: "0.9s" },
        { top: "40%", left: "15%", size: 3, delay: "1.3s" },
        { top: "20%", left: "38%", size: 5, delay: "0.6s" },
    ];

    return (
        <div style={{ position: "relative", width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* Static rings */}
            {[80, 120, 160].map((size) => (
                <div key={size} style={{ position: "absolute", width: size, height: size, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.05)" }} />
            ))}

            {/* Ping rings */}
            {[60, 100, 140].map((size, i) => (
                <div key={size} style={{ position: "absolute", width: size, height: size, borderRadius: "50%", border: "1px solid rgba(233,69,96,0.2)", animation: `ss-ping 2.5s ease-out ${i * 0.8}s infinite` }} />
            ))}

            {/* Sweep */}
            <div style={{ position: "absolute", width: 160, height: 160, borderRadius: "50%", overflow: "hidden", animation: "ss-spin 5s linear infinite" }}>
                <div style={{ position: "absolute", top: "50%", left: "50%", width: "50%", height: "50%", transformOrigin: "0% 100%", background: "conic-gradient(from 0deg, transparent 0deg, rgba(233,69,96,0.3) 55deg, transparent 55deg)", transform: "rotate(-90deg)" }} />
            </div>

            {/* Lead dots */}
            {dots.map((dot, i) => (
                <div key={i} style={{ position: "absolute", top: dot.top, left: dot.left, width: dot.size, height: dot.size, borderRadius: "50%", background: "#e94560", boxShadow: "0 0 6px #e94560", animation: `ss-dot ${dot.delay} 2s ease-in-out infinite` }} />
            ))}

            {/* Centre */}
            <div style={{ position: "relative", zIndex: 2, width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg, #1e2340, #252b4a)", border: "1px solid rgba(233,69,96,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                ⊕
            </div>
        </div>
    );
}

const VALUE_PROPS = [
    { icon: "🔭", title: "AI research on every lead", sub: "Signals, funding, hiring — automated" },
    { icon: "✍️", title: "Hyper-personalised outreach", sub: "Not mail-merge. Real context." },
    { icon: "📬", title: "Domain-safe sending", sub: "99.7% deliverability, auto-throttled" },
];

export function AuthShell() {
    return (
        <div style={{ background: "linear-gradient(160deg, #16213e 0%, #0f3460 100%)", padding: "48px 40px", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden", borderRight: "1px solid rgba(255,255,255,0.07)" }}>
            {/* Grid overlay */}
            <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "40px 40px", maskImage: "radial-gradient(ellipse 100% 100% at 50% 50%, black, transparent)", pointerEvents: "none" }} />

            {/* Red blob */}
            <div aria-hidden style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(233,69,96,0.15) 0%, transparent 70%)", top: -60, right: -80, pointerEvents: "none" }} />

            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#e94560", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 18px rgba(233,69,96,0.35)", flexShrink: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="1.5" />
                        <circle cx="12" cy="12" r="5" stroke="#fff" strokeWidth="1.5" />
                        <circle cx="12" cy="12" r="1.5" fill="#fff" />
                        <line x1="12" y1="2" x2="12" y2="7" stroke="#fff" strokeWidth="1.5" />
                        <line x1="12" y1="17" x2="12" y2="22" stroke="#fff" strokeWidth="1.5" />
                    </svg>
                </div>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, color: "#f0f2ff", letterSpacing: "-0.02em" }}>
                    Scout<span style={{ color: "#e94560" }}>Send</span>
                </span>
            </div>

            {/* Radar + value props */}
            <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 32, padding: "20px 0" }}>
                <RadarOrb />
                <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
                    {VALUE_PROPS.map((item, i) => (
                        <div key={item.title} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, animation: `ss-fadeUp 0.5s ease ${(i + 1) * 0.1}s both` }}>
                            <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.28)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                                {item.icon}
                            </div>
                            <div>
                                <p style={{ fontSize: 13, fontWeight: 500, color: "#f0f2ff", lineHeight: 1.3 }}>{item.title}</p>
                                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{item.sub}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Footer */}
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e", animation: "ss-dot 0s 2s ease-in-out infinite" }} />
                All systems operational · SOC 2 compliant
            </div>
        </div>
    );
}