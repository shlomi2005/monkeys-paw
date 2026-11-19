import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ExampleEntry } from './api/api-schemas';
import styles from './App.module.css';
import { BindingCard } from './components/BindingCard';
import { Brazier } from './components/Brazier';
import { CircleRing } from './components/CircleRing';
import { Curtain } from './components/Curtain';
import { ExampleCards } from './components/ExampleCards';
import { GrantedStamp } from './components/GrantedStamp';
import { IntegrityMedal } from './components/IntegrityMedal';
import { LiveRegion } from './components/LiveRegion';
import { PawStateText } from './components/PawStateText';
import { PlateFrame } from './components/PlateFrame';
import { RayDisc } from './components/RayDisc';
import { StopButton } from './components/StopButton';
import { WishLine } from './components/WishLine';
import { useReducedMotion } from './hooks/use-reduced-motion';
import { PawStage } from './scene/PawStage';
import { useSession } from './state/SessionProvider';
import { removeStaticShell } from './static-shell';

/**
 * The page. It must be rendered inside a `SessionProvider`.
 *
 * DOM order is the tab order (design.md section 7, Req 8.1): wish input, "for…", "Make the wish", example cards,
 * circles, binding card, Stop, export slot, sound slot. CSS grid places the pieces (App.module.css); there is no
 * positive tabindex. The decoration, the paw, the stamp and the medal are not focusable, so they can sit anywhere.
 */
export function App() {
  const {
    ctx,
    view,
    examples,
    notice,
    examplesOnly,
    liveText,
    liveSeq,
    grantedSeq,
    dispatch,
    submitWish,
    bridge,
  } = useSession();
  const reducedMotion = useReducedMotion();

  const [text, setText] = useState('');
  const [context, setContext] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Typing a wish of one's own dims the example row until the next submit (Req 3.2).
  const [dimmed, setDimmed] = useState(false);

  // The static shell from index.html has done its job once React has committed. It is position: fixed, so removing
  // it moves nothing.
  useEffect(() => {
    removeStaticShell();
  }, []);

  const entries = examples.kind === 'ready' ? examples.entries : [];
  const selected = selectedIndex === null ? null : (entries[selectedIndex] ?? null);

  function typed(): void {
    setSelectedIndex(null);
    setDimmed(true);
  }

  function selectExample(entry: ExampleEntry, index: number): void {
    setText(entry.wish.text);
    setContext(entry.wish.context ?? '');
    setSelectedIndex(index);
    setDimmed(false);
  }

  function makeWish(): void {
    // The example only counts while the wish line still holds it as shown (the session checks this too).
    const unmodified =
      selected !== null && text === selected.wish.text && context === (selected.wish.context ?? '');
    submitWish({ text, context, example: unmodified ? selected : null });
    setDimmed(false);
  }

  function rewrite(): void {
    dispatch({ type: 'rewrite' });
    setText('');
    setContext('');
    setSelectedIndex(null);
    setDimmed(false);
  }

  // Escape in the example row deselects the card (Req 8.1). Escape in the binding card is the dialog's own cancel.
  function handleExamplesKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') setSelectedIndex(null);
  }

  return (
    <main className={styles.page}>
      <PlateFrame>
        <div className={styles.layout}>
          <div className={styles.decorLayer} aria-hidden="true">
            <Curtain side="left" />
            <Curtain side="right" />
            <Brazier side="left" />
            <Brazier side="right" />
          </div>

          <div className={styles.pawBox}>
            <RayDisc pulseKey={grantedSeq} />
            <PawStage bridge={bridge} initialCurled={ctx.curled} reducedMotion={reducedMotion} />
            <div className={styles.stateText}>
              <PawStateText ctx={ctx} />
            </div>
          </div>

          <div className={styles.stampSlot}>
            <GrantedStamp grant={ctx.grant} grantedSeq={grantedSeq} reducedMotion={reducedMotion} />
          </div>

          <div className={styles.medalSlot}>
            <IntegrityMedal medal={view.medal} />
          </div>

          <LiveRegion text={liveText} seq={liveSeq} />

          {/* From here on, DOM order is the tab order. */}
          <div className={styles.wishSlot}>
            <WishLine
              text={text}
              context={context}
              onTextChange={(value) => {
                setText(value);
                typed();
              }}
              onContextChange={(value) => {
                setContext(value);
                typed();
              }}
              onSubmit={makeWish}
              granting={ctx.phase === 'granting'}
              notice={notice}
            />
          </div>

          <div className={styles.examplesSlot} onKeyDown={handleExamplesKeyDown}>
            <ExampleCards state={examples} selectedIndex={selectedIndex} dimmed={dimmed} onSelect={selectExample} />
          </div>

          {/* Same centre as the paw box, so the desktop ring (a zero-size anchor) surrounds the paw. */}
          <div className={styles.ringSlot}>
            <CircleRing
              circles={view.circles}
              curses={ctx.grant?.curses ?? []}
              onActivate={(index) => dispatch({ type: 'circle_activated', index })}
            />
          </div>

          <BindingCard
            card={view.card}
            judgeResting={examplesOnly}
            notice={notice}
            onAccept={(clause) => dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause })}
            onRewrite={rewrite}
            onCancel={() => dispatch({ type: 'card_closed' })}
          />

          <div className={styles.actions}>
            <StopButton show={view.showStop} onStop={() => dispatch({ type: 'stop' })} />
            {/* Task 37 puts "Take the scroll" and "Open in Kiro" here. */}
            <div className={styles.exportSlot} data-slot="export" />
          </div>

          {/* Task 35 puts the sound toggle here. Last in the DOM, shown in a corner. */}
          <div className={styles.soundSlot} data-slot="sound" />
        </div>
      </PlateFrame>
    </main>
  );
}
