// src/components/layout/Footer.tsx
export function Footer() {
  return (
    <footer className="app-footer">
      <span>
        GrandForge · Powered by{' '}
        <a href="https://stockfishchess.org" target="_blank" rel="noopener noreferrer">Stockfish 18</a>
        {' '}(GPLv3) — Analysis runs in your browser.
      </span>
      <span>
        Opening data from{' '}
        <a href="https://lichess.org" target="_blank" rel="noopener noreferrer">Lichess</a>
      </span>
    </footer>
  );
}

export default Footer;
