"use client";

/**
 * Full-bleed landing hero with a background video.
 *
 * Drop a file at `frontend/public/hero.mp4` (and optionally `hero-poster.jpg`) and it plays
 * automatically, muted + looped, behind the headline. If the video is missing or fails to
 * load, we fall back to an animated gradient so the hero always looks intentional — nothing
 * breaks before you add the asset.
 */
import { useState } from "react";
import Link from "next/link";

export function Hero() {
  const [videoOk, setVideoOk] = useState(true);

  return (
    <header className="hero">
      <div className="hero-media">
        {videoOk && (
          <video
            className="hero-video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster="/hero-poster.jpg"
            onError={() => setVideoOk(false)}
            onStalled={() => setVideoOk(false)}
          >
            {/* Add your asset here. MP4 (H.264) is the safest cross-browser choice. */}
            <source src="/hero.mp4" type="video/mp4" />
            <source src="/hero.webm" type="video/webm" />
          </video>
        )}
        {/* gradient/scrim sits above the video for legibility, and IS the fallback */}
        <div className="hero-scrim" />
      </div>

      <div className="hero-inner">
        <div className="hero-badges">
          <span className="hero-badge">World ID</span>
          <span className="hero-badge">ERC-8004</span>
          <span className="hero-badge">ENS</span>
        </div>
        <h1 className="hero-title">
          Human<span className="hero-title-accent">Rank</span>
        </h1>
        <p className="hero-tagline">
          The sybil-proof human review layer for ERC-8004.
        </p>
        <p className="hero-sub">
          Everyone built the rails to <i>pay</i> AI agents. Nobody built the way to know
          <b> which ones deserve it.</b> One human, one vote — enforced on-chain.
        </p>
        <div className="hero-cta">
          <Link href="/compare/1" className="btn btn-primary">
            See 5.0★ vs 1.0★ →
          </Link>
          <a href="#directory" className="btn btn-ghost">
            Browse the agent directory
          </a>
        </div>
      </div>

      <a href="#directory" className="hero-scroll" aria-label="Scroll to directory">
        ↓
      </a>
    </header>
  );
}
