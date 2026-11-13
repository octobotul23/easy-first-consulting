import { useRef, type CSSProperties } from 'react';
import type { CommonContent, FloorContent } from '../content';
import { useFlowReveal } from '../hooks/useFlowReveal';
import { goTo, stopIndex, useLift, type LiftMode } from '../state/elevator';

interface Props {
  floor: FloorContent;
  level: number;
  /** Index of this floor's stop (to know when its doors are open). */
  index: number;
  mode: LiftMode;
  common: CommonContent;
}

/** One service floor: the glass panel that appears when the lift doors open. */
export function FloorPanel({ floor, level, index, mode, common }: Props) {
  const ref = useRef<HTMLElement>(null);
  const open3d = useLift((s) => s.openStop === index);
  const seen = useFlowReveal(ref, mode === 'flow');
  const open = mode === '3d' ? open3d : seen;
  const p = `floors.${floor.id}`;
  let n = 0;
  const step = () => ({ '--i': n++ }) as CSSProperties;

  return (
    <article ref={ref} className={`floor-panel panel-${mode} ${open ? 'is-open' : ''}`}>
      <div className="panel-card">
        <span className="panel-plaque" aria-hidden="true">
          {String(level).padStart(2, '0')}
        </span>
        <p className="reveal panel-kicker" style={step()}>
          <span className="floor-no">
            {common.floorWord} {level}
          </span>
          <span className="sep" aria-hidden="true" />
          <span data-edit={`${p}.kicker`}>{floor.kicker}</span>
        </p>
        <h2 id={`${floor.id}-title`} className="reveal panel-title" style={step()} data-edit={`${p}.title`}>
          {floor.title}
        </h2>
        {floor.intro && (
          <p className="reveal panel-intro" style={step()} data-edit={`${p}.intro`}>
            {floor.intro}
          </p>
        )}

        {floor.facts.map((fact, i) =>
          fact.items.length ? (
            <div key={i} className="reveal fact" style={step()}>
              <h3 className="panel-label" data-edit={`${p}.facts.${i}.label`}>
                {fact.label}
              </h3>
              <ul className="chips">
                {fact.items.map((item, j) => (
                  <li key={j} data-edit={`${p}.facts.${i}.items.${j}`}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}

        {floor.steps.items.length > 0 && (
          <div className="reveal fact" style={step()}>
            <h3 className="panel-label" data-edit={`${p}.steps.label`}>
              {floor.steps.label}
            </h3>
            <ol className="steps">
              {floor.steps.items.map((s, j) => (
                <li key={j}>
                  <span className="step" data-edit={`${p}.steps.items.${j}`}>
                    {s}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {floor.points.length > 0 && (
          <ul className="reveal points" style={step()}>
            {floor.points.map((pt, j) => (
              <li key={j} data-edit={`${p}.points.${j}`}>
                {pt}
              </li>
            ))}
          </ul>
        )}

        {floor.blocks.length > 0 && (
          <div className="blocks">
            {floor.blocks.map((b, j) => (
              <div key={j} className="reveal block" style={step()}>
                <h3 data-edit={`${p}.blocks.${j}.heading`}>{b.heading}</h3>
                <p data-edit={`${p}.blocks.${j}.text`}>{b.text}</p>
              </div>
            ))}
          </div>
        )}

        {floor.note && (
          <p className="reveal note" style={step()} data-edit={`${p}.note`}>
            {floor.note}
          </p>
        )}

        <a
          href="#contact"
          className="reveal panel-cta"
          style={step()}
          onClick={(e) => {
            const i = stopIndex('contact');
            if (i < 0) return;
            e.preventDefault();
            goTo(i);
          }}
        >
          <span data-edit="common.cta">{common.cta}</span>
          <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
            <path d="M1 5h13M10 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </a>
      </div>
    </article>
  );
}
