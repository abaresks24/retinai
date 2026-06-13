"use client";

/**
 * Landing `/` — full-bleed background video, protocol title, a Docs link, and a Launch app
 * button into `/app`. Nothing else: the marketing surface. The video plays muted + looped
 * with a cinematic treatment; if `public/hero.mp4` is absent it falls back to an animated
 * gradient so the page always looks intentional.
 */
import { useState } from "react";
import Link from "next/link";
import { Logo } from "./components/Logo";

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "/docs";

export default function Landing() {
  const [videoOk, setVideoOk] = useState(true);
  const docsIsExternal = /^https?:\/\//.test(DOCS_URL);

  return (
    <main className="hero hero--landing">
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
          >
            <source src="/hero.mp4" type="video/mp4" />
            <source src="/hero.webm" type="video/webm" />
          </video>
        )}
        <div className="hero-scrim" />
      </div>

      <div className="hero-inner">
        <div className="hero-badges">
          <span className="hero-badge">World ID</span>
          <span className="hero-badge">ERC-8004</span>
          <span className="hero-badge">ENS</span>
        </div>

        <Logo size={92} className="hero-logo" />
        <h1 className="hero-title">
          Ly<span className="hero-title-accent">nx</span>
        </h1>
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
