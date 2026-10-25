import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <p className="brand brand--footer">Holoraa</p>
          <p className="faint">One simple place to talk and share. Early build.</p>
        </div>
        <nav aria-label="Footer">
          <ul>
            <li>
              <a href="#principles">Principles</a>
            </li>
            <li>
              <a href="#holories">Holories</a>
            </li>
            <li>
              <Link href="/status">System status</Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
