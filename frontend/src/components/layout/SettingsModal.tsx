import { useState } from 'react';
import { Cpu, Monitor, Grid3x3 } from 'lucide-react';
import Modal from '../ui/Modal';
import Tabs, { type TabItem } from '../ui/Tabs';
import Toggle from '../ui/Toggle';
import Slider from '../ui/Slider';
import { useUIStore } from '../../store/uiStore';
import { useEngineStore } from '../../store/engineStore';
import { playMoveSound } from '../../services/SoundManager';
import { usePieceAnimation } from '../../hooks/usePieceAnimation';
import { BOARD_THEMES, PIECE_SETS } from '../../types/themes';
import {
  ENGINE_CONFIGS,
  engineSupportsOption,
  isMultiThreaded,
  type EngineVersion,
} from '../../services/EngineManager';

/**
 * The single entry point for every persisted preference. Before this, prefs were
 * spread across five surfaces (board tools popover, theme picker row, header
 * theme button, two engine-version selectors, engine controls) with no one place
 * to find them — see docs/superpowers/audits/ui-audit.md §2 for the inventory.
 *
 * This modal does not replace those surfaces; the in-context controls stay where
 * a user reaches for them mid-analysis. It is the discoverable superset, and it
 * is the only place the otherwise-unreachable prefs (legal-move dots, engine
 * depth, strength cap) can be set at all.
 */

type SettingsTabId = 'engine' | 'interface' | 'board';

const MULTIPV_OPTIONS: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];
const HASH_OPTIONS = [16, 32, 64, 128, 256, 512];
const MAX_THREADS =
  typeof navigator !== 'undefined' ? Math.max(1, navigator.hardwareConcurrency ?? 1) : 1;

// Piece-glide options. The top end stays under the review autoplay's fastest
// dwell (450 ms) so a glide can never outlast the step that triggered it.
const ANIMATION_STEPS: { ms: number; label: string }[] = [
  { ms: 0, label: 'Off' },
  { ms: 120, label: 'Fast' },
  { ms: 200, label: 'Normal' },
  { ms: 320, label: 'Slow' },
];

/** Snap a stored duration onto the nearest offered step so the control always
 *  shows one option as active, even for a value written by an older build. */
function nearestAnimationStep(ms: number): number {
  let best = ANIMATION_STEPS[0].ms;
  for (const step of ANIMATION_STEPS) {
    if (Math.abs(step.ms - ms) < Math.abs(best - ms)) best = step.ms;
  }
  return best;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function ChoiceRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  format,
  columns,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  disabled?: boolean;
  format?: (v: T) => string;
  columns: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          {label}
        </span>
        <span className="font-mono font-medium text-[var(--text-accent)]">
          {format ? format(value) : String(value)}
        </span>
      </div>
      <div
        role="group"
        aria-label={label}
        className="grid gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((opt) => {
          const active = opt === value;
          return (
            <button
              key={String(opt)}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(opt)}
              className={`h-7 rounded font-mono text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'bg-gradient-to-b from-[var(--gold)] to-[var(--gold-dim)] text-[var(--bg-void)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {format ? format(opt) : String(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EngineSettings() {
  const engineVersion = useEngineStore((s) => s.engineVersion);
  const switchEngine = useEngineStore((s) => s.switchEngine);
  const isLoading = useEngineStore((s) => s.isLoading);
  const isEnabled = useEngineStore((s) => s.isEnabled);
  const depth = useEngineStore((s) => s.depth);
  const setDepth = useEngineStore((s) => s.setDepth);
  const multiPV = useEngineStore((s) => s.multiPV);
  const setMultiPV = useEngineStore((s) => s.setMultiPV);
  const engineSettings = useEngineStore((s) => s.engineSettings);
  const setEngineSettings = useEngineStore((s) => s.setEngineSettings);
  const infiniteMode = useEngineStore((s) => s.infiniteMode);

  const computerAnalysis = useUIStore((s) => s.computerAnalysis);
  const setComputerAnalysis = useUIStore((s) => s.setComputerAnalysis);

  // Threads only mean something on the MT build; NNUE is an sf16-only option.
  // Emitting either elsewhere gets `No such option` back — see engine.md.
  const threadsMeaningful = isMultiThreaded(engineVersion);
  const nnueSupported = engineSupportsOption(engineVersion, 'Use NNUE');

  return (
    <div className="flex flex-col gap-4">
      <Toggle
        label="Computer analysis"
        description="Evaluate positions as you browse"
        checked={computerAnalysis}
        onChange={setComputerAnalysis}
      />

      <SectionLabel>Engine build</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {(Object.keys(ENGINE_CONFIGS) as EngineVersion[]).map((id) => {
          const cfg = ENGINE_CONFIGS[id];
          const active = id === engineVersion;
          return (
            <button
              key={id}
              type="button"
              disabled={isLoading}
              aria-pressed={active}
              onClick={() => { if (id !== engineVersion) void switchEngine(id); }}
              className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-50 ${
                active
                  ? 'border-[var(--gold)] bg-[var(--bg-hover)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">{cfg.label}</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">{cfg.sizeMB}MB</span>
              </div>
              <span className="text-xs leading-snug text-[var(--text-secondary)]">
                {cfg.description}
              </span>
            </button>
          );
        })}
      </div>

      <SectionLabel>Search</SectionLabel>
      <ChoiceRow
        label="Lines"
        value={multiPV}
        options={MULTIPV_OPTIONS}
        onChange={setMultiPV}
        disabled={!isEnabled}
        columns={5}
      />
      <Slider
        label="Target depth"
        min={8}
        max={30}
        value={depth}
        onChange={setDepth}
        disabled={!isEnabled}
      />
      <p className="-mt-2 text-[10px] leading-tight text-[var(--text-muted)]">
        {infiniteMode
          ? 'Live analysis runs continuously, so this depth applies to game review.'
          : 'Applies to live analysis and game review.'}
      </p>

      <SectionLabel>Resources</SectionLabel>
      <Slider
        label="Threads"
        min={1}
        max={MAX_THREADS}
        value={engineSettings.threads}
        onChange={(v) => setEngineSettings({ threads: v })}
        disabled={!isEnabled || !threadsMeaningful}
      />
      {!threadsMeaningful && (
        <p className="-mt-2 text-[10px] leading-tight text-[var(--text-muted)]">
          This build is single-threaded. Pick the multi-threaded build above to use more than one
          thread.
        </p>
      )}
      <ChoiceRow
        label="Hash"
        value={engineSettings.hash}
        options={HASH_OPTIONS}
        onChange={(v) => setEngineSettings({ hash: v })}
        disabled={!isEnabled}
        format={(v) => `${v}`}
        columns={6}
      />

      <SectionLabel>Strength</SectionLabel>
      <Slider
        label="Skill level"
        min={0}
        max={20}
        value={engineSettings.skillLevel}
        onChange={(v) => setEngineSettings({ skillLevel: v })}
        disabled={!isEnabled}
        formatValue={(v) => (v === 20 ? 'Max' : String(v))}
      />
      <Toggle
        label="Cap strength to a rating"
        description="Play and analyse at a chosen Elo instead of full strength"
        checked={engineSettings.limitStrength}
        onChange={(v) => setEngineSettings({ limitStrength: v })}
        disabled={!isEnabled}
      />
      {engineSettings.limitStrength && (
        <Slider
          label="Rating"
          min={1320}
          max={3190}
          step={10}
          value={engineSettings.uciElo}
          onChange={(v) => setEngineSettings({ uciElo: v })}
          disabled={!isEnabled}
        />
      )}
      {nnueSupported && (
        <Toggle
          label="Neural-net evaluation"
          description="Available on this build only"
          checked={engineSettings.useNNUE}
          onChange={(v) => setEngineSettings({ useNNUE: v })}
          disabled={!isEnabled}
        />
      )}
    </div>
  );
}

function InterfaceSettings() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const disclosureButtons = useUIStore((s) => s.disclosureButtons);
  const setDisclosureButtons = useUIStore((s) => s.setDisclosureButtons);
  const moveAnnotations = useUIStore((s) => s.moveAnnotations);
  const setMoveAnnotations = useUIStore((s) => s.setMoveAnnotations);
  const inlineNotation = useUIStore((s) => s.inlineNotation);
  const setInlineNotation = useUIStore((s) => s.setInlineNotation);
  const variationOpacity = useUIStore((s) => s.variationOpacity);
  const setVariationOpacity = useUIStore((s) => s.setVariationOpacity);
  const evaluationGauge = useUIStore((s) => s.evaluationGauge);
  const setEvaluationGauge = useUIStore((s) => s.setEvaluationGauge);
  const bestMoveArrow = useUIStore((s) => s.bestMoveArrow);
  const setBestMoveArrow = useUIStore((s) => s.setBestMoveArrow);
  const soundEnabled = useUIStore((s) => s.soundEnabled);
  const setSoundEnabled = useUIStore((s) => s.setSoundEnabled);
  const soundVolume = useUIStore((s) => s.soundVolume);
  const setSoundVolume = useUIStore((s) => s.setSoundVolume);

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel>Appearance</SectionLabel>
      <ChoiceRow
        label="Theme"
        value={theme}
        options={['dark', 'light'] as const}
        onChange={setTheme}
        format={(v) => (v === 'dark' ? 'Dark' : 'Light')}
        columns={2}
      />

      <SectionLabel>Analysis display</SectionLabel>
      <Toggle
        label="Evaluation gauge"
        description="The vertical bar beside the board"
        checked={evaluationGauge}
        onChange={setEvaluationGauge}
      />
      <Toggle
        label="Best-move arrow"
        checked={bestMoveArrow}
        onChange={setBestMoveArrow}
      />

      <SectionLabel>Sound</SectionLabel>
      <Toggle
        label="Move sounds"
        description="Distinct tones for moves, captures, castling, check and game end"
        checked={soundEnabled}
        onChange={(v) => {
          setSoundEnabled(v);
          // Play one note on enable so the choice is audible immediately — and
          // so the first note lands inside this click, satisfying the browser's
          // autoplay gesture requirement.
          if (v) playMoveSound('move');
        }}
      />
      {soundEnabled && (
        <Slider
          label="Volume"
          min={0}
          max={100}
          value={Math.round(soundVolume * 100)}
          onChange={(v) => {
            setSoundVolume(v / 100);
            playMoveSound('move');
          }}
          formatValue={(v) => `${v}%`}
        />
      )}

      <SectionLabel>Move list</SectionLabel>
      <Toggle
        label="Move annotations"
        description="Show review glyphs next to moves"
        checked={moveAnnotations}
        onChange={setMoveAnnotations}
      />
      <Toggle
        label="Inline variations"
        description="Show side lines in the flow of the move list rather than indented"
        checked={inlineNotation}
        onChange={setInlineNotation}
      />
      {/* The flag is named `disclosureButtons` for historical reasons, but its
          only effect is whether variations render at all — MoveList has no
          disclosure buttons to control. Labelled for what it does. */}
      <Toggle
        label="Show variations"
        description="Off hides every side line from the move list"
        checked={disclosureButtons}
        onChange={setDisclosureButtons}
      />
      <Slider
        label="Variation opacity"
        min={0}
        max={100}
        value={variationOpacity}
        onChange={setVariationOpacity}
        formatValue={(v) => `${v}%`}
      />
    </div>
  );
}

function BoardSettings() {
  const boardTheme = useUIStore((s) => s.boardTheme);
  const setBoardTheme = useUIStore((s) => s.setBoardTheme);
  const pieceSet = useUIStore((s) => s.pieceSet);
  const setPieceSet = useUIStore((s) => s.setPieceSet);
  const orientation = useUIStore((s) => s.orientation);
  const flipBoard = useUIStore((s) => s.flipBoard);
  const showCoordinates = useUIStore((s) => s.showCoordinates);
  const setShowCoordinates = useUIStore((s) => s.setShowCoordinates);
  const showLegalMoves = useUIStore((s) => s.showLegalMoves);
  const setShowLegalMoves = useUIStore((s) => s.setShowLegalMoves);
  const undefendedPieces = useUIStore((s) => s.undefendedPieces);
  const setUndefendedPieces = useUIStore((s) => s.setUndefendedPieces);
  const pinnedPieces = useUIStore((s) => s.pinnedPieces);
  const setPinnedPieces = useUIStore((s) => s.setPinnedPieces);
  const checkableKing = useUIStore((s) => s.checkableKing);
  const setCheckableKing = useUIStore((s) => s.setCheckableKing);
  const pieceAnimationMs = useUIStore((s) => s.pieceAnimationMs);
  const setPieceAnimationMs = useUIStore((s) => s.setPieceAnimationMs);
  // Read the OS flag so the copy below can explain why the control looks inert.
  // usePieceAnimation returns 0 under reduced motion; comparing against the
  // stored value tells us the override is active rather than the user's choice.
  const effectiveAnimationMs = usePieceAnimation();
  const reduceMotion = effectiveAnimationMs === 0 && pieceAnimationMs > 0;

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel>Board theme</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {BOARD_THEMES.map((t) => {
          const active = boardTheme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={`Board theme: ${t.label}`}
              aria-pressed={active}
              onClick={() => setBoardTheme(t.id)}
              className={`h-9 w-9 overflow-hidden rounded-md border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
                active
                  ? 'scale-105 border-[var(--gold)] ring-1 ring-[var(--gold)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}
            >
              <div className="flex h-full w-full flex-col">
                <div className="flex-1" style={{ background: t.previewColors[0] }} />
                <div className="flex-1" style={{ background: t.previewColors[1] }} />
              </div>
            </button>
          );
        })}
      </div>

      <SectionLabel>Piece set</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {PIECE_SETS.map((ps) => {
          const active = pieceSet === ps.id;
          return (
            <button
              key={ps.id}
              type="button"
              title={ps.label}
              aria-label={`Piece set: ${ps.label}`}
              aria-pressed={active}
              onClick={() => setPieceSet(ps.id)}
              className={`flex h-10 w-10 items-center justify-center rounded-md border bg-[var(--bg-elevated)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
                active
                  ? 'scale-105 border-[var(--gold)] ring-1 ring-[var(--gold)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}
            >
              <img src={`${ps.path}${ps.previewPiece}`} alt={ps.label} width={26} height={26} />
            </button>
          );
        })}
      </div>

      <SectionLabel>Behavior</SectionLabel>
      <ChoiceRow
        label="Orientation"
        value={orientation}
        options={['white', 'black'] as const}
        onChange={(v) => { if (v !== orientation) flipBoard(); }}
        format={(v) => (v === 'white' ? 'White' : 'Black')}
        columns={2}
      />
      <Toggle label="Coordinates" checked={showCoordinates} onChange={setShowCoordinates} />
      <ChoiceRow
        label="Piece animation"
        value={nearestAnimationStep(pieceAnimationMs)}
        options={ANIMATION_STEPS.map((s) => s.ms)}
        onChange={setPieceAnimationMs}
        format={(v) => ANIMATION_STEPS.find((s) => s.ms === v)?.label ?? String(v)}
        columns={4}
      />
      {reduceMotion && (
        <p className="-mt-2 text-[10px] leading-tight text-[var(--text-muted)]">
          Your system asks for reduced motion, so animation stays off regardless of this
          setting. Turn that off in your OS accessibility settings to use it.
        </p>
      )}
      <Toggle
        label="Legal-move dots"
        description="Mark where a selected piece can go"
        checked={showLegalMoves}
        onChange={setShowLegalMoves}
      />

      <SectionLabel>Tactical highlights</SectionLabel>
      <p className="-mt-2 text-[10px] leading-tight text-[var(--text-muted)]">
        Shown only while computer analysis is on.
      </p>
      <Toggle
        label="Undefended pieces"
        checked={undefendedPieces}
        onChange={setUndefendedPieces}
      />
      <Toggle label="Pinned pieces" checked={pinnedPieces} onChange={setPinnedPieces} />
      <Toggle label="King in danger" checked={checkableKing} onChange={setCheckableKing} />
    </div>
  );
}

export default function SettingsModal() {
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<SettingsTabId>('engine');

  const tabs: TabItem[] = [
    { id: 'engine', label: 'Engine', icon: <Cpu size={14} /> },
    { id: 'interface', label: 'Interface', icon: <Monitor size={14} /> },
    { id: 'board', label: 'Board', icon: <Grid3x3 size={14} /> },
  ];

  return (
    <Modal
      isOpen={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Settings"
      description="Engine strength, interface behavior and board appearance. Everything here is saved on this device."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <Tabs tabs={tabs} activeId={tab} onChange={(id) => setTab(id as SettingsTabId)} fullWidth />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'engine' && <EngineSettings />}
          {tab === 'interface' && <InterfaceSettings />}
          {tab === 'board' && <BoardSettings />}
        </div>
      </div>
    </Modal>
  );
}
