export default function CloudHostingLayout({ left, main, right }) {
  return (
    <main className="cloud-hosting-page">
      <aside className="hosting-left">{left}</aside>
      <div className="hosting-main">{main}</div>
      <aside className="hosting-right">{right}</aside>
    </main>
  );
}
