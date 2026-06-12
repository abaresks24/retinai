import Link from "next/link";

export function TopBar() {
  return (
    <div className="topbar">
      <Link href="/" className="brand">
        <h1>
          Human<span className="grad">Rank</span>
        </h1>
        <span className="tag">one human · one vote per agent</span>
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
