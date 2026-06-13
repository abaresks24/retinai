"use client";

/**
 * Landing `/` — full-bleed background video, logo + title, a Docs link, and a Launch app
 * button into `/app`. The video plays muted + seamlessly looped (we pre-empt the native
 * loop stall by seeking to 0 just before the stream ends); if `public/hero.mp4` is absent
 * it falls back to an animated gradient so the page always looks intentional.
 */
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Logo } from "./components/Logo";

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "/docs";

export default function Landing() {
  const [videoOk, setVideoOk] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const docsIsExternal = /^https?:\/\//.test(DOCS_URL);

  // Seamless loop: jump back to the start a hair before the media actually ends, which
  // avoids the brief end-of-stream stall the native `loop` attribute shows.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.duration && v.currentTime >= v.duration - 0.3) {
        v.currentTime = 0;
        v.play().catch(() => {});
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [videoOk]);

  return (
    <main className="hero hero--landing">
      <div className="hero-media">
        {videoOk && (
          <video
            ref={videoRef}
            className="hero-video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster="/hero-poster.jpg"
            onError={() => setVideoOk(false)}
          >
            <source src="/hero.mp4" type="video/mp4" />
            <source src="/hero.webm" type="video/webm" />
          </video>
        )}
        <div className="hero-scrim" />
      </div>

      <div className="hero-inner">
        <div className="hero-wordmark"><h1 className="hero-title">
          Retin<span className="hero-title-accent">AI</span>
        </h1><Logo size={118} className="hero-logo" /></div>
        <p className="hero-tagline">The sybil-proof human review layer for ERC-8004.</p>
        <p className="hero-sub">
          Everyone built the rails to <i>pay</i> AI agents. Nobody built the way to know
          <b> which ones deserve it.</b> One human, one vote — enforced on-chain.
        </p>

        <div className="hero-cta">
          <Link href="/app" className="btn btn-primary btn-lg">
            Launch app →
          </Link>
          {docsIsExternal ? (
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-lg">
              Docs
            </a>
          ) : (
            <Link href={DOCS_URL} className="btn btn-ghost btn-lg">
              Docs
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
