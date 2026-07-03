// src/pages/LearnAccuracyPage.tsx
import { Link } from 'react-router-dom';
import StaticPage from './StaticPage';

export function LearnAccuracyPage() {
  return (
    <StaticPage title="How Chess Accuracy Is Calculated">
      <p>
        When GrandForge reviews your game it gives each player an <strong>accuracy score</strong>{' '}
        from 0 to 100. This page explains exactly how that number is computed — the same
        open-source math used by Lichess, so your score here is directly comparable.
      </p>

      <h2>Step 1: Every position becomes a winning chance</h2>
      <p>
        Stockfish evaluates positions in <em>centipawns</em> (hundredths of a pawn). A +1.00
        advantage means you are effectively a pawn up. Centipawns are converted to a{' '}
        <strong>win percentage</strong> — the chance a strong player converts that advantage —
        with a logistic curve:
      </p>
      <pre><code>Win% = 50 + 50 × (2 / (1 + e^(-0.00368208 × centipawns)) − 1)</code></pre>
      <p>
        So 0 centipawns = 50% (equal), +100 ≈ 59%, +300 ≈ 75%, and a forced mate counts as 100%.
        The curve flattens at the extremes: going from +5 to +7 barely changes your winning
        chances, which is why the review doesn&apos;t punish &quot;inaccuracies&quot; in already
        completely winning positions.
      </p>

      <h2>Step 2: Every move is scored by the winning chances it gave up</h2>
      <p>
        For each move, GrandForge compares the win percentage <em>before</em> the move (playing
        the engine&apos;s best line) to the win percentage <em>after</em> your actual move. The
        drop is the move&apos;s cost, converted to a move accuracy with an exponential:
      </p>
      <pre><code>Accuracy = 103.1668 × e^(-0.04354 × ΔWin%) − 3.1669 + 1</code></pre>
      <p>
        Play the best move (Δ = 0) and you get 100. Lose 10% of your winning chances and the move
        scores ≈ 68. Lose 30% (a typical blunder) and it scores ≈ 25.
      </p>

      <h2>Step 3: Move scores blend into a game score</h2>
      <p>
        Game accuracy is not a plain average — one blunder in an otherwise perfect game should
        (and does) hurt. GrandForge blends two aggregates, again following Lichess:
      </p>
      <ul>
        <li>
          a <strong>volatility-weighted mean</strong> — moves played in sharp, swingy phases of the
          game (measured by the standard deviation of win% over a sliding window) count more than
          moves in dead-equal shuffling;
        </li>
        <li>
          a <strong>harmonic mean</strong> — which is dragged down hard by low outliers, so
          blunders cost more than good moves compensate.
        </li>
      </ul>

      <h2>What counts toward accuracy</h2>
      <p>
        Opening <strong>book moves are excluded</strong> — you get no credit and no penalty for
        theory. Accuracy starts counting from the first move out of book.
      </p>

      <h2>The performance rating estimate</h2>
      <p>
        Alongside accuracy, the review shows an estimated <strong>game rating</strong> — what Elo
        your play in this single game resembled. It maps accuracy through a cubic curve, subtracts
        a penalty per blunder/mistake/miss (normalized per 30 moves), and adds a bonus when the
        positions you faced were objectively complex (measured by how far apart the engine&apos;s
        top two choices score). Short games get a wide confidence label — a 10-move win tells us
        much less than a 60-move grind, so ratings are tagged provisional / low / medium / high
        confidence by the number of rated moves.
      </p>

      <p>
        Next: <Link to="/learn/move-classifications">how moves are classified from Brilliant to
        Blunder</Link>, or <Link to="/">review one of your own games free</Link>.
      </p>
    </StaticPage>
  );
}

export default LearnAccuracyPage;
