// src/pages/LearnClassificationsPage.tsx
import { Link } from 'react-router-dom';
import StaticPage from './StaticPage';

const LADDER = [
  { icon: '!!', name: 'Brilliant', color: '#1baca6', desc: 'The best move — and it sacrifices material or finds a quiet, hard-to-see resource. The engine confirms you gave up something real and it works.' },
  { icon: '!', name: 'Great', color: '#5c8bb0', desc: 'The engine’s top choice in a position where finding it mattered — often the only move that holds the position together.' },
  { icon: '★', name: 'Best', color: '#96bc4b', desc: 'The strongest move available. Loses essentially nothing (≤ 0.5% winning chances).' },
  { icon: '👍', name: 'Excellent', color: '#96bc4b', desc: 'Nearly as good as the best move — gives up at most 2% winning chances.' },
  { icon: '✔', name: 'Good', color: '#82ac49', desc: 'A solid, healthy move. Gives up at most 5% winning chances.' },
  { icon: '📖', name: 'Book', color: '#c8a84b', desc: 'Established opening theory (matched against the Lichess ECO opening database). Not scored.' },
  { icon: '?!', name: 'Inaccuracy', color: '#f0c945', desc: 'Slightly loose — drops 5–10% of your winning chances. Rarely fatal, but they add up.' },
  { icon: '?', name: 'Mistake', color: '#e68f39', desc: 'A real error — drops 10–20% of your winning chances or hands the opponent a serious initiative.' },
  { icon: '✗', name: 'Miss', color: '#e05a5a', desc: 'You had a forced win (a mate or decisive tactic the engine could see) and played something else.' },
  { icon: '??', name: 'Blunder', color: '#ca3431', desc: 'Drops more than 20% of your winning chances — hangs material, misses a mate threat, or turns a win into a loss.' },
];

export function LearnClassificationsPage() {
  return (
    <StaticPage title="Chess Move Classifications Explained">
      <p>
        Every move in a GrandForge game review gets one of ten labels, from{' '}
        <strong>Brilliant</strong> to <strong>Blunder</strong>. The system is built on{' '}
        <strong>expected points</strong> — how much of your winning chances a move keeps or throws
        away — the same approach used by Lichess and Chess.com, not raw centipawns. That matters:
        losing 50 centipawns in a sharp equal position is serious; losing 50 centipawns when you
        are +9 changes nothing.
      </p>

      <h2>The ten classifications</h2>
      <div className="classification-legend">
        {LADDER.map((c) => (
          <div key={c.name} className="classification-legend-row">
            <span
              className="classification-legend-icon"
              style={{ background: c.color }}
              aria-hidden="true"
            >
              {c.icon}
            </span>
            <div>
              <strong>{c.name}</strong>
              <p>{c.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <h2>How Brilliant moves are detected</h2>
      <p>
        A move is a candidate for <strong>Brilliant</strong> only if it is already the engine&apos;s
        best move. GrandForge then checks that it is a genuine <em>sacrifice</em> — you left a
        piece hanging or gave up material the opponent can actually take — or an unusually quiet
        move in a tactical position. Finally the position after the sacrifice must still be good
        for you: giving away a rook that loses is not brilliant, it is a blunder. The thresholds
        adapt slightly to rating: a 1200 player&apos;s bishop sacrifice earns the label more easily
        than a grandmaster&apos;s, mirroring how Chess.com calibrates by strength.
      </p>

      <h2>Why the same move can get different labels in different games</h2>
      <p>
        Classification depends on the <em>position</em>, not the move itself. Nf3 can be Book on
        move 2, Best in a middlegame, and a Blunder if it hangs your queen. And because the ladder
        measures winning-chance loss, the identical centipawn drop is judged more harshly in a
        balanced position than in a completely decided one.
      </p>

      <p>
        Related: <Link to="/learn/chess-accuracy">how the accuracy percentage is calculated</Link>,
        or <Link to="/">analyze your own games free with Stockfish 18</Link>.
      </p>
    </StaticPage>
  );
}

export default LearnClassificationsPage;
