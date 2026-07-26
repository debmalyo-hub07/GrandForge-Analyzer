// src/components/layout/Footer.tsx
import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="app-footer">
      <span>
        GrandForge · Powered by{' '}
        <a href="https://stockfishchess.org" target="_blank" rel="noopener noreferrer">Stockfish 18</a>
        {' '}(GPLv3) — Analysis runs in your browser.
      </span>
      <span className="app-footer-links">
        <Link to="/learn/chess-accuracy">Accuracy</Link>
        {' · '}
        <Link to="/learn/move-classifications">Classifications</Link>
        {' · '}
        <Link to="/privacy">Privacy</Link>
        {' · '}
        Opening data from{' '}
        <a href="https://lichess.org" target="_blank" rel="noopener noreferrer">Lichess</a>
      </span>
    </footer>
  );
}

export default Footer;
