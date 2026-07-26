// src/pages/PrivacyPage.tsx
import StaticPage from './StaticPage';

export function PrivacyPage() {
  return (
    <StaticPage title="Privacy Policy">
      <p className="static-updated">Last updated: 3 July 2026</p>

      <h2>The short version</h2>
      <p>
        GrandForge analyzes chess games <strong>in your browser</strong>. The Stockfish engine runs
        locally on your device as WebAssembly — the moves you play and the games you analyze are
        not uploaded to run the analysis. No account is required to use any feature.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Usage analytics (Google Analytics 4).</strong> We use Google Analytics to
          understand aggregate usage — page views, approximate location (country/city level),
          device and browser type, and interaction events. Google Analytics sets cookies for this
          purpose. See{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            Google&apos;s privacy policy
          </a>{' '}
          for how Google processes this data. You can opt out with the{' '}
          <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
            GA opt-out browser add-on
          </a>.
        </li>
        <li>
          <strong>Position evaluations.</strong> To speed up game review for everyone, evaluations
          of board positions (the position itself, its engine score, and search depth — never who
          played it or when) may be stored in our shared position cache. A chess position contains
          no personal information.
        </li>
        <li>
          <strong>Optional account data.</strong> If you create an account, we store your email
          and a hashed password, used only for sign-in. Accounts are optional; every analysis
          feature works without one.
        </li>
      </ul>

      <h2>What we don&apos;t collect</h2>
      <ul>
        <li>No sale of personal data, to anyone, ever.</li>
        <li>No advertising identifiers or cross-site tracking pixels beyond Google Analytics.</li>
        <li>No reading of your Chess.com / Lichess credentials — game import uses each site&apos;s
          public API with only the username you type.</li>
      </ul>

      <h2>Local storage</h2>
      <p>
        Your preferences (board theme, engine settings, analysis depth) are kept in your
        browser&apos;s <code>localStorage</code> and never leave your device.
      </p>

      <h2>Third-party services</h2>
      <ul>
        <li><strong>Google Fonts</strong> — typography (your browser requests font files from Google).</li>
        <li><strong>Chess.com / Lichess public APIs</strong> — game import and avatars, only when you use import.</li>
        <li><strong>Lichess tablebase</strong> — exact endgame lookups for positions with 7 or fewer pieces.</li>
        <li><strong>MongoDB Atlas</strong> — hosts the shared position cache and optional accounts.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions about this policy: open an issue on{' '}
        <a
          href="https://github.com/debmalyo-hub07/GrandForge-Analyzer"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>.
      </p>
    </StaticPage>
  );
}

export default PrivacyPage;
