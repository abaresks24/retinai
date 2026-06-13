import Link from "next/link";
import { Logo } from "./Logo";

export function TopBar() {
  return (
    <div className="topbar">
      <Link href="/" className="brand">
        <Logo size={30} />
        <span>
          <h1>
            Retin<span className="grad">AI</span>
          </h1>
          <span className="tag">one human · one vote per agent</span>
        </span>
      </Link>
      <nav className="nav">
        <Link href="/app">Directory</Link>
        <Link href="/leaderboard">Leaderboard</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/">Home</Link>
      </nav>
    </div>
  );
}
