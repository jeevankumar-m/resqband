"use client";

import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";

// ─── Scroll-Scrubbed GIF ─────────────────────────────────────────────────────
function useScrollGif(src: string, scrollProgress: MotionValue<number>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<ImageBitmap[]>([]);
  const currentIdxRef = useRef(0);

  const drawFrame = useCallback((idx: number) => {
    const frames = framesRef.current;
    const canvas = canvasRef.current;
    if (!frames.length || !canvas || !canvas.width || !canvas.height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bmp = frames[idx];
    // Scale to cover + 1.1x zoom matching the original img
    const scale = Math.max(canvas.width / bmp.width, canvas.height / bmp.height) * 1.1;
    const sw = bmp.width * scale;
    const sh = bmp.height * scale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh);
    currentIdxRef.current = idx;
  }, []);

  // Parse GIF → ImageBitmaps (pre-composited, disposal-aware)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { parseGIF, decompressFrames } = await import("gifuct-js");
      const res = await fetch(src);
      const buf = await res.arrayBuffer();
      const gif = parseGIF(buf);
      const rawFrames = decompressFrames(gif, true);
      const gw: number = (gif as any).lsd.width;
      const gh: number = (gif as any).lsd.height;

      const composite = document.createElement("canvas");
      composite.width = gw;
      composite.height = gh;
      const cctx = composite.getContext("2d")!;
      const bitmaps: ImageBitmap[] = [];
      let savedState: ImageData | null = null;

      for (let i = 0; i < rawFrames.length; i++) {
        if (cancelled) return;
        const frame = rawFrames[i];
        if (frame.disposalType === 3) savedState = cctx.getImageData(0, 0, gw, gh);

        const patch = document.createElement("canvas");
        patch.width = frame.dims.width;
        patch.height = frame.dims.height;
        const rgba = new Uint8ClampedArray(frame.patch);
        patch.getContext("2d")!.putImageData(
          new ImageData(rgba, frame.dims.width, frame.dims.height),
          0,
          0,
        );
        cctx.drawImage(patch, frame.dims.left, frame.dims.top);
        bitmaps.push(await createImageBitmap(composite));

        if (frame.disposalType === 2) {
          cctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
        } else if (frame.disposalType === 3 && savedState) {
          cctx.putImageData(savedState, 0, 0);
        }
      }

      if (!cancelled && bitmaps.length) {
        framesRef.current = bitmaps;
        setTimeout(() => drawFrame(0), 0);
      }
    }
    load().catch(console.error);
    return () => { cancelled = true; };
  }, [src, drawFrame]);

  // Keep canvas pixel dims in sync with its CSS size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (!canvas.offsetWidth || !canvas.offsetHeight) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      drawFrame(currentIdxRef.current);
    });
    ro.observe(canvas);
    if (canvas.offsetWidth && canvas.offsetHeight) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    return () => ro.disconnect();
  }, [drawFrame]);

  // Scroll → frame index
  useMotionValueEvent(scrollProgress, "change", (v) => {
    const frames = framesRef.current;
    if (!frames.length) return;
    drawFrame(Math.min(Math.floor(v * frames.length), frames.length - 1));
  });

  return canvasRef;
}

/** Scroll distance for the pinned hero (each ~1 viewport ≈ one “step”). */
const HERO_SCROLL_VH = 5;

// ─── Feature Card ───────────────────────────────────────────────────────────
const FeatureCard = ({ title, desc, index }: { title: string; desc: string; index: number }) => (
  <motion.div
    initial={{ opacity: 0, x: index % 2 === 0 ? -50 : 50 }}
    whileInView={{ opacity: 1, x: 0 }}
    viewport={{ margin: "-100px" }}
    transition={{ duration: 0.8, ease: "easeOut" }}
    className="relative p-8 border border-emerald-500/20 bg-[#050a05]/80 backdrop-blur-xl group hover:border-emerald-500/50 transition-all max-w-md"
  >
    <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-emerald-500" />
    <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-emerald-500" />
    <span className="text-[10px] font-black text-emerald-800 tracking-[0.3em]">FEATURE_0{index + 1}</span>
    <h3 className="text-2xl font-black text-emerald-400 mt-2 mb-4 tracking-tighter uppercase italic">{title}</h3>
    <p className="text-sm text-emerald-600 font-bold leading-relaxed uppercase opacity-80">{desc}</p>
  </motion.div>
);

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  align?: "center" | "left";
}) {
  return (
    <div className={`mb-14 max-w-3xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-700 mb-3">{eyebrow}</p>
      <h2 className="text-3xl md:text-4xl font-black tracking-tight text-white uppercase italic">{title}</h2>
      <p className="mt-4 text-sm md:text-base text-emerald-600/90 font-bold leading-relaxed uppercase tracking-tight">
        {subtitle}
      </p>
    </div>
  );
}

type HeroSlideProps = {
  active: boolean;
  children: ReactNode;
  className?: string;
};

function HeroSlide({ active, children, className = "" }: HeroSlideProps) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center text-center p-4 z-10 ${className}`}
      style={{ pointerEvents: active ? "auto" : "none" }}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

export default function LandingPage() {
  const heroScrollRef = useRef<HTMLDivElement>(null);
  const [heroPhase, setHeroPhase] = useState(0);

  const { scrollYProgress: heroProgress } = useScroll({
    target: heroScrollRef,
    offset: ["start start", "end start"],
  });

  useMotionValueEvent(heroProgress, "change", (v) => {
    const next = v < 0.25 ? 0 : v < 0.5 ? 1 : v < 0.75 ? 2 : 3;
    setHeroPhase(next);
  });

  const smoothGifProgress = useSpring(heroProgress, { stiffness: 80, damping: 22, mass: 0.4 });
  const gifCanvasRef = useScrollGif("/herogif.gif", smoothGifProgress);

  const videoScale = useTransform(heroProgress, [0, 0.35, 1], [1.12, 1, 0.96]);
  const videoRadius = useTransform(heroProgress, [0, 0.25], ["0rem", "1.25rem"]);
  /** Subtle drift on the GIF so the “frame” moves with scroll too */
  const mediaY = useTransform(heroProgress, [0, 0.5, 1], [0, -18, -32]);
  const mediaX = useTransform(heroProgress, [0, 1], [0, 12]);

  const op0 = useTransform(heroProgress, [0, 0.18, 0.22, 0.26], [1, 1, 0.4, 0]);
  const op1 = useTransform(heroProgress, [0.20, 0.26, 0.42, 0.48], [0, 1, 1, 0]);
  const op2 = useTransform(heroProgress, [0.44, 0.50, 0.66, 0.72], [0, 1, 1, 0]);
  const op3 = useTransform(heroProgress, [0.68, 0.74, 1], [0, 1, 1]);

  // Scroll-synced motion (enter / hold / exit per quarter)
  const y0 = useTransform(heroProgress, [0, 0.1, 0.18, 0.26], [110, 0, 0, -95]);
  const scale0 = useTransform(heroProgress, [0, 0.12, 0.2, 0.26], [0.9, 1, 1, 0.94]);
  const blur0 = useTransform(heroProgress, [0.18, 0.26], [0, 6]);
  const filter0 = useTransform(blur0, (b) => `blur(${b}px)`);

  const x1 = useTransform(heroProgress, [0.2, 0.27, 0.42, 0.5], [100, 0, 0, -85]);
  const y1 = useTransform(heroProgress, [0.2, 0.27, 0.42, 0.5], [35, 0, 0, -45]);
  const rotate1 = useTransform(heroProgress, [0.2, 0.27, 0.42, 0.5], [4, 0, 0, -3]);

  const x2 = useTransform(heroProgress, [0.44, 0.51, 0.66, 0.74], [-105, 0, 0, 90]);
  const y2 = useTransform(heroProgress, [0.44, 0.51, 0.66, 0.74], [50, 0, 0, -55]);
  const rotate2 = useTransform(heroProgress, [0.44, 0.51, 0.66, 0.74], [-5, 0, 0, 4]);

  const y3 = useTransform(heroProgress, [0.68, 0.75, 0.9, 1], [85, 0, 0, -70]);
  const scale3 = useTransform(heroProgress, [0.68, 0.76, 0.95, 1], [0.86, 1, 1, 0.97]);

  return (
    <div className="bg-[#020402] text-emerald-500 font-mono relative">
      {/* Pinned hero: scroll through this block advances slides; then page continues below */}
      <div ref={heroScrollRef} className="relative w-full" style={{ height: `${HERO_SCROLL_VH * 100}vh` }}>
        <div className="sticky top-0 h-screen w-full flex items-center justify-center overflow-hidden">
          <motion.div
            style={{ scale: videoScale, borderRadius: videoRadius }}
            className="relative w-full h-full max-w-[95vw] max-h-[90vh] overflow-hidden border border-emerald-500/10 shadow-[0_0_100px_rgba(16,185,129,0.1)]"
          >
            <motion.div className="absolute inset-0 overflow-hidden bg-black" style={{ y: mediaY, x: mediaX }}>
              <canvas
                ref={gifCanvasRef}
                className="absolute inset-0 w-full h-full opacity-60 mix-blend-screen"
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#020402_100%)]" />
            </motion.div>
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />
          </motion.div>

          {/* Slide 0 — brand + CTAs */}
          <motion.div
            style={{ opacity: op0, y: y0, scale: scale0, filter: filter0 }}
            className="absolute inset-0 z-[11] flex flex-col items-center justify-center p-4 pointer-events-none will-change-transform"
          >
            <HeroSlide active={heroPhase === 0}>
              <div className="text-[12px] font-black tracking-[0.8em] uppercase text-emerald-800 mb-4 animate-pulse">
                // System Initialization //
              </div>
              <h1 className="text-6xl md:text-9xl font-black tracking-tighter italic text-white drop-shadow-[0_0_30px_rgba(16,185,129,0.5)]">
                RESQ<span className="text-emerald-500 underline decoration-8">BAND</span>
              </h1>
              <p className="mt-6 text-lg max-w-xl font-bold uppercase tracking-tight text-emerald-400">
                The next generation of decentralized emergency mesh protocols. Low latency. Zero dependency.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link
                  href="/overview"
                  className="px-8 py-3 bg-emerald-500 text-black font-black hover:bg-white transition-colors"
                >
                  DECODE_MANIFESTO
                </Link>
                <Link
                  href="/radar"
                  className="px-8 py-3 border border-emerald-500 font-black hover:bg-emerald-500/10 transition-all"
                >
                  VIEW_RADAR
                </Link>
              </div>
              <p className="mt-14 text-[10px] font-black uppercase tracking-[0.35em] text-emerald-800/90 animate-bounce">
                Scroll ↓ to continue
              </p>
            </HeroSlide>
          </motion.div>

          {/* Slide 1 */}
          <motion.div
            style={{ opacity: op1, x: x1, y: y1, rotate: rotate1 }}
            className="absolute inset-0 z-[12] flex flex-col items-center justify-center p-4 pointer-events-none will-change-transform"
          >
            <HeroSlide active={heroPhase === 1}>
              <span className="text-[10px] font-black text-emerald-800 tracking-[0.4em] mb-3">PHASE_02 // MESH</span>
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase italic text-white max-w-2xl">
                Resilience by design
              </h2>
              <p className="mt-6 text-base md:text-lg max-w-xl font-bold uppercase tracking-tight text-emerald-400/95 leading-relaxed">
                Every node repeats. Networks that survive terrain, weather, and silence — no towers required.
              </p>
            </HeroSlide>
          </motion.div>

          {/* Slide 2 */}
          <motion.div
            style={{ opacity: op2, x: x2, y: y2, rotate: rotate2 }}
            className="absolute inset-0 z-[13] flex flex-col items-center justify-center p-4 pointer-events-none will-change-transform"
          >
            <HeroSlide active={heroPhase === 2}>
              <span className="text-[10px] font-black text-emerald-800 tracking-[0.4em] mb-3">PHASE_03 // SIGNAL</span>
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase italic text-white max-w-2xl">
                Tactical RSSI
              </h2>
              <p className="mt-6 text-base md:text-lg max-w-xl font-bold uppercase tracking-tight text-emerald-400/95 leading-relaxed">
                Path-loss aware ranging for live distance sense — built for operators, not slide decks.
              </p>
            </HeroSlide>
          </motion.div>

          {/* Slide 3 */}
          <motion.div
            style={{ opacity: op3, y: y3, scale: scale3 }}
            className="absolute inset-0 z-[14] flex flex-col items-center justify-center p-4 pointer-events-none will-change-transform"
          >
            <HeroSlide active={heroPhase === 3}>
              <span className="text-[10px] font-black text-emerald-800 tracking-[0.4em] mb-3">PHASE_04 // SECURE</span>
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase italic text-white max-w-2xl">
                Encrypted SOS channel
              </h2>
              <p className="mt-6 text-base md:text-lg max-w-xl font-bold uppercase tracking-tight text-emerald-400/95 leading-relaxed">
                Emergency frames stay visible to the right people. Then drop into the live console.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link
                  href="/overview"
                  className="px-8 py-3 bg-emerald-500 text-black font-black hover:bg-white transition-colors"
                >
                  OPEN_CONSOLE
                </Link>
                <Link href="/sos" className="px-8 py-3 border border-emerald-500 font-black hover:bg-emerald-500/10 transition-all">
                  SOS_MONITOR
                </Link>
              </div>
              <p className="mt-12 text-[10px] font-black uppercase tracking-[0.35em] text-emerald-800/90">
                Keep scrolling — site continues below
              </p>
            </HeroSlide>
          </motion.div>

          {/* Step dots */}
          <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                  heroPhase === i ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-emerald-900"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ─── Landing: product sections (hero above is unchanged) ─── */}
      <div className="relative z-20 border-t border-emerald-500/15 bg-[#020402]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-950/20 to-transparent" />

        <div className="mx-auto max-w-6xl px-4 md:px-8 lg:px-10">
          {/* Trust / stack */}
          <section className="relative py-16 md:py-20">
            <SectionHeading
              eyebrow="Built for field operations"
              title="Everything you need to run a mesh"
              subtitle="Hardware-agnostic telemetry, a live command console, and analytics that stay in sync with the field."
            />
            <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
              {["LoRa mesh", "ESP32 gateway", "Live WebSocket feed", "SOS + PING + PONG", "AES-256"].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-emerald-500/25 bg-emerald-950/30 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-500/90"
                >
                  {label}
                </span>
              ))}
            </div>
          </section>

          {/* Stats */}
          <section className="border-y border-emerald-500/15 bg-[#030805]/80 py-14 md:py-16">
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-6">
              {[
                { k: "Sub-second", v: "Live updates", d: "WebSocket stream to your browser" },
                { k: "Multi-view", v: "One session", d: "Overview, radar, SOS, analytics" },
                { k: "Open stack", v: "Arduino + Python", d: "Hackable hub & server" },
                { k: "Field-first", v: "RSSI aware", d: "Distance cues from signal" },
              ].map((s) => (
                <div key={s.v} className="text-center md:text-left">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-800">{s.k}</p>
                  <p className="mt-2 text-xl font-black tabular-nums text-emerald-300 md:text-2xl">{s.v}</p>
                  <p className="mt-1 text-[11px] font-bold uppercase leading-snug text-emerald-700/90">{s.d}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Core capabilities */}
          <section id="product" className="py-20 md:py-28">
            <SectionHeading
              eyebrow="Product"
              title="Core capabilities"
              subtitle="Three pillars that define how RESQBAND behaves when networks fail and seconds matter."
            />
            <div className="grid gap-10 md:grid-cols-3 md:gap-8">
              <FeatureCard
                index={0}
                title="Mesh Resilience"
                desc="Every node is a repeater. Build networks that span entire mountain ranges with zero cellular towers or satellites required."
              />
              <FeatureCard
                index={1}
                title="Tactical RSSI"
                desc="Proprietary log-distance path loss algorithms provide real-time distance estimation with sub-meter precision in optimal conditions."
              />
              <FeatureCard
                index={2}
                title="Encrypted SOS"
                desc="AES-256 bit encryption ensures that emergency signals are only visible to authorized tactical response teams."
              />
            </div>
          </section>

          {/* How it works */}
          <section className="py-20 md:py-28">
            <SectionHeading
              eyebrow="Workflow"
              title="How it works"
              subtitle="From RF in the field to pixels on your dashboard — a straight path you can reason about under stress."
            />
            <div className="grid gap-8 md:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Nodes transmit",
                  body: "Rangers and hubs exchange pings, SOS, and telemetry over LoRa with RSSI metadata.",
                },
                {
                  step: "02",
                  title: "Gateway aggregates",
                  body: "The ESP32 hub forwards frames over serial to server.py, which normalizes and fans out events.",
                },
                {
                  step: "03",
                  title: "Console reacts",
                  body: "Your browser holds a single WebSocket session — switch views without losing history.",
                },
              ].map((row) => (
                <motion.div
                  key={row.step}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.5 }}
                  className="relative rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/40 to-transparent p-8"
                >
                  <span className="text-4xl font-black text-emerald-500/20">{row.step}</span>
                  <h3 className="mt-4 text-lg font-black uppercase tracking-tight text-white">{row.title}</h3>
                  <p className="mt-3 text-sm font-bold leading-relaxed text-emerald-600/95">{row.body}</p>
                </motion.div>
              ))}
            </div>
          </section>

          {/* Capability grid */}
          <section className="py-20 md:py-28">
            <SectionHeading
              eyebrow="Platform"
              title="What you get in the box"
              subtitle="Operator-grade surfaces — not a prototype UI bolted onto a demo."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { t: "Live overview", d: "Unified feed of alerts with type, sender, RSSI, and timestamps." },
                { t: "Tactical radar", d: "Synthetic bearing + distance from RSSI for situational awareness." },
                { t: "SOS monitor", d: "Dedicated channel for emergency traffic with visual emphasis." },
                { t: "Analytics", d: "Rolling rates, RSSI series, and mix by alert type for the session." },
                { t: "Serial status", d: "Gateway connection surfaced in-app when the hub reports COM port." },
                { t: "Session persistence", d: "Telemetry ring buffer survives route changes until you close the tab." },
              ].map((item) => (
                <motion.div
                  key={item.t}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  className="rounded-lg border border-emerald-500/15 bg-[#050a08]/90 p-6 transition-colors hover:border-emerald-500/35"
                >
                  <h4 className="text-sm font-black uppercase tracking-tight text-emerald-300">{item.t}</h4>
                  <p className="mt-2 text-xs font-bold leading-relaxed text-emerald-700">{item.d}</p>
                </motion.div>
              ))}
            </div>
          </section>

          {/* Use cases */}
          <section className="py-20 md:py-28">
            <SectionHeading
              eyebrow="Use cases"
              title="Built for scenarios where comms disappear"
              subtitle="Same stack — different missions. Position RESQBAND where failure is not an option."
            />
            <div className="grid gap-8 md:grid-cols-2">
              {[
                {
                  title: "Search & rescue",
                  body: "Track last-known signal strength and direction cues while teams move through terrain. SOS traffic stays visible in a dedicated monitor.",
                },
                {
                  title: "Disaster & off-grid ops",
                  body: "Stand up a mesh without carrier dependency. Analytics help you see whether the network is healthy before you commit assets.",
                },
              ].map((u) => (
                <div
                  key={u.title}
                  className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-8 md:p-10"
                >
                  <h3 className="text-xl font-black uppercase italic text-white">{u.title}</h3>
                  <p className="mt-4 text-sm font-bold leading-relaxed text-emerald-600">{u.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section className="py-20 md:pb-28">
            <SectionHeading
              eyebrow="FAQ"
              title="Questions operators ask"
              subtitle="Straight answers — no roadmap vapor."
            />
            <div className="mx-auto max-w-3xl space-y-3">
              {[
                {
                  q: "Do I need cellular or Wi-Fi for the mesh?",
                  a: "No. LoRa operates in license-free bands; the dashboard only needs a path to your Python server (local or tunneled).",
                },
                {
                  q: "Will I lose data when I switch pages?",
                  a: "No. The app keeps a shared telemetry buffer for the browser session so overview, radar, SOS, and analytics stay consistent.",
                },
                {
                  q: "What hardware does this target?",
                  a: "The reference stack uses an ESP32-class hub and Arduino-compatible ranger firmware — extend or swap radios within your constraints.",
                },
                {
                  q: "Is this production-ready?",
                  a: "It’s built as a serious field console. Hardening, auth, and deployment are yours to layer on top of the open pipeline.",
                },
              ].map((f) => (
                <details
                  key={f.q}
                  className="group rounded-lg border border-emerald-500/20 bg-[#050a08]/80 px-5 py-4 open:border-emerald-500/40"
                >
                  <summary className="cursor-pointer list-none text-left text-sm font-black uppercase tracking-tight text-emerald-300 marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {f.q}
                      <span className="text-emerald-600 transition group-open:rotate-45">+</span>
                    </span>
                  </summary>
                  <p className="mt-4 border-t border-emerald-500/15 pt-4 text-sm font-bold leading-relaxed text-emerald-700">{f.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/50 to-[#020402] px-8 py-14 text-center md:px-16">
            <h2 className="text-3xl font-black uppercase italic tracking-tight text-white md:text-4xl">Ship the console next</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm font-bold uppercase tracking-tight text-emerald-600">
              Open the live dashboard, plug your gateway, and validate the full loop in one sitting.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/overview"
                className="rounded-lg bg-emerald-500 px-8 py-3.5 text-sm font-black text-black transition hover:bg-white"
              >
                Launch command center
              </Link>
              <Link
                href="/analytics"
                className="rounded-lg border border-emerald-500/50 px-8 py-3.5 text-sm font-black text-emerald-300 transition hover:bg-emerald-500/10"
              >
                View analytics
              </Link>
            </div>
          </section>

          {/* Footer */}
          <footer className="mt-20 border-t border-emerald-500/20 py-16 md:py-20">
            <div className="grid gap-12 md:grid-cols-4 md:gap-8">
              <div className="md:col-span-2">
                <p className="text-2xl font-black italic tracking-tight text-white">
                  RESQ<span className="text-emerald-500">BAND</span>
                </p>
                <p className="mt-3 max-w-sm text-xs font-bold uppercase leading-relaxed text-emerald-800">
                  Emergency mesh telemetry with a browser-native command surface.
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-800">Product</p>
                <ul className="mt-4 space-y-2 text-sm font-bold text-emerald-600">
                  <li>
                    <Link href="/overview" className="hover:text-emerald-400">
                      Overview
                    </Link>
                  </li>
                  <li>
                    <Link href="/radar" className="hover:text-emerald-400">
                      Radar
                    </Link>
                  </li>
                  <li>
                    <Link href="/sos" className="hover:text-emerald-400">
                      SOS monitor
                    </Link>
                  </li>
                  <li>
                    <Link href="/analytics" className="hover:text-emerald-400">
                      Analytics
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-800">Meta</p>
                <p className="mt-4 text-[10px] font-black uppercase tracking-[0.35em] text-emerald-900">RESQBAND // 2026</p>
                <p className="mt-2 text-[10px] font-black uppercase tracking-[0.35em] text-emerald-900">Encrypted link ready</p>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
