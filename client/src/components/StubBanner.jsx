/** Marks a page as a functional placeholder that its owner will restyle. */
export function StubBanner({ children }) {
  return <p className="stub__banner">{children} · functional placeholder</p>;
}
