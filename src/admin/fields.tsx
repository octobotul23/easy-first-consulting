/**
 * Form fields generated from the structure of the content: the type of each default
 * value decides the control (text, on/off, slider, list, group), the rules decide the
 * limits, and labels.ts says what the field changes on the site.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { ITEM_TEMPLATES } from '../content';
import { ruleFor, type Path } from '../content/rules';
import { media } from '../lib/demo';
import { blankLike, getAt, keyOf, useEditor } from './editor';
import { infoFor, labelFor } from './labels';

export function Field({ path }: { path: Path }) {
  const { draft } = useEditor();
  const info = infoFor(path);
  if (info.hidden) return null;
  const value = getAt(draft, path);
  if (typeof value === 'boolean') return <Toggle path={path} />;
  if (typeof value === 'number') return <RangeField path={path} />;
  if (typeof value === 'string') {
    const kind = ruleFor(path).kind;
    if (kind === 'image' || kind === 'video') return <MediaField path={path} video={kind === 'video'} />;
    return <TextField path={path} />;
  }
  if (Array.isArray(value)) return <ListField path={path} />;
  if (value && typeof value === 'object') return <Group path={path} />;
  return null;
}

/** All fields of an object, in the order of the defaults. `skip` leaves some out. */
export function Fields({ path, skip = [] }: { path: Path; skip?: string[] }) {
  const { draft } = useEditor();
  const value = getAt(draft, path) as Record<string, unknown>;
  return (
    <>
      {Object.keys(value)
        .filter((k) => !skip.includes(k))
        .map((k) => (
          <Field key={k} path={[...path, k]} />
        ))}
    </>
  );
}

function Group({ path }: { path: Path }) {
  const info = infoFor(path);
  const { errors } = useEditor();
  const prefix = keyOf(path) + '.';
  const bad = [...errors.keys()].filter((k) => k.startsWith(prefix)).length;
  const body = (
    <div className="group-body">
      {info.help && <p className="help">{info.help}</p>}
      <Fields path={path} />
    </div>
  );
  if (info.folded) {
    return (
      <details className="group" data-path={keyOf(path)}>
        <summary>
          {labelFor(path)}
          {bad > 0 && <span className="badge-bad">{bad} to fix</span>}
        </summary>
        {body}
      </details>
    );
  }
  return (
    <fieldset className="group" data-path={keyOf(path)}>
      <legend>{labelFor(path)}</legend>
      {body}
    </fieldset>
  );
}

function FieldShell({
  path,
  id,
  children,
  count,
  label = labelFor(path),
}: {
  path: Path;
  id: string;
  children: ReactNode;
  count?: number;
  label?: ReactNode;
}) {
  const { errors } = useEditor();
  const info = infoFor(path);
  const rule = ruleFor(path);
  const error = errors.get(keyOf(path));
  const max = rule.max ?? (rule.kind === 'https' || rule.kind === 'image' || rule.kind === 'video' ? 500 : 300);
  return (
    <div className={`field ${error ? 'has-error' : ''}`} data-path={keyOf(path)}>
      <label htmlFor={id}>
        {label}
        {rule.required && <span className="req" title="Can’t be empty"> *</span>}
      </label>
      {info.help && (
        <p className="help" id={`${id}-help`}>
          {info.help}
        </p>
      )}
      {children}
      <div className="field-foot">
        <span className="error" id={`${id}-err`} aria-live="polite">
          {error}
        </span>
        {count !== undefined && count > 0 && (
          <span className={`count ${count > max ? 'over' : ''}`}>
            {count} / {max}
          </span>
        )}
      </div>
    </div>
  );
}

const describedBy = (id: string, path: Path, error?: string) =>
  [infoFor(path).help ? `${id}-help` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;

const INPUT_MODE = { email: 'email', phone: 'tel', https: 'url', image: 'url' } as const;

function TextField({ path, label }: { path: Path; label?: ReactNode }) {
  const { draft, set, errors } = useEditor();
  const id = useId();
  const value = getAt(draft, path) as string;
  const rule = ruleFor(path);
  const error = errors.get(keyOf(path));
  const multiline = rule.kind === 'multiline' || (rule.max ?? 0) > 200;
  const common = {
    id,
    value,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, path, error),
    spellCheck: !rule.kind || rule.kind === 'multiline',
  };
  return (
    <FieldShell path={path} id={id} count={value.length} label={label}>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(e) => set(path, e.target.value)} />
      ) : (
        <input
          {...common}
          type="text"
          inputMode={rule.kind && rule.kind in INPUT_MODE ? INPUT_MODE[rule.kind as keyof typeof INPUT_MODE] : undefined}
          autoComplete="off"
          onChange={(e) => set(path, e.target.value)}
        />
      )}
    </FieldShell>
  );
}

function Toggle({ path }: { path: Path }) {
  const { draft, set } = useEditor();
  const id = useId();
  const on = getAt(draft, path) as boolean;
  const info = infoFor(path);
  return (
    <div className="field field-toggle" data-path={keyOf(path)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        className="switch"
        onClick={() => set(path, !on)}
        aria-describedby={info.help ? `${id}-help` : undefined}
      >
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
        <span className="switch-label">{labelFor(path)}</span>
        <span className="switch-state">{on ? 'On' : 'Off'}</span>
      </button>
      {info.help && (
        <p className="help" id={`${id}-help`}>
          {info.help}
        </p>
      )}
    </div>
  );
}

function RangeField({ path }: { path: Path }) {
  const { draft, set } = useEditor();
  const id = useId();
  const value = getAt(draft, path) as number;
  const rule = ruleFor(path);
  const [min, max] = rule.range ?? [0, 10];
  const step = rule.step ?? 1;
  const unit = infoFor(path).unit;
  // As many decimals as the step has (0.05 shows 0.85, not 0.9), so each notch reads differently.
  const digits = (String(step).split('.')[1] ?? '').length;
  const shown = `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  return (
    <FieldShell path={path} id={id}>
      <div className="range-row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => set(path, Number(e.target.value))}
          aria-valuetext={shown}
        />
        <output htmlFor={id}>{shown}</output>
      </div>
    </FieldShell>
  );
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

/** An image or a video: upload a file, or type a link / a file of the site. */
function MediaField({ path, video = false }: { path: Path; video?: boolean }) {
  const { draft, set, upload, errors } = useEditor();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const value = getAt(draft, path) as string;
  const rule = ruleFor(path);
  const error = errors.get(keyOf(path));
  const types = video ? VIDEO_TYPES : IMAGE_TYPES;
  const limitMb = video ? 40 : 5;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    if (!types.includes(file.type)) {
      setProblem(
        video
          ? `“${file.name}” is not an MP4 or WebM video. Export it as MP4 (H.264) and try again.`
          : `“${file.name}” is not a PNG, JPG or WebP image. Save it in one of these formats and try again.`,
      );
      return;
    }
    if (file.size > limitMb * 1024 * 1024) {
      setProblem(
        video
          ? `The video is ${(file.size / 1048576).toFixed(1)} MB; the limit is 40 MB. Export it at 1920 × 1080 with a lower quality (bitrate) and try again.`
          : `The image is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB. Make it smaller (about 2000 pixels wide is plenty) and try again.`,
      );
      return;
    }
    setBusy(true);
    try {
      set(path, await upload(file));
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <FieldShell path={path} id={id}>
      <div className="image-row">
        <div className="image-thumb">
          {!value ? (
            <span>{video ? 'None' : 'Automatic'}</span>
          ) : video ? (
            <video src={media(value)} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" />
          ) : (
            <img src={media(value)} alt="" />
          )}
        </div>
        <div className="image-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : video ? 'Upload a video' : 'Upload an image'}
          </button>
          {!rule.required && value && (
            <button type="button" className="btn btn-quiet" onClick={() => set(path, '')}>
              Remove
            </button>
          )}
          <input ref={fileRef} type="file" accept={types.join(',')} hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>
      <input
        id={id}
        type="text"
        inputMode="url"
        className="image-url"
        value={value}
        placeholder="or a link: https://…"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, path, error)}
        onChange={(e) => set(path, e.target.value)}
      />
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </FieldShell>
  );
}

/* ---------- Lists ---------- */

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function ListField({ path }: { path: Path }) {
  const { draft, set, errors } = useEditor();
  const list = getAt(draft, path) as unknown[];
  const info = infoFor(path);
  const rule = ruleFor(path);
  const key = String(path[path.length - 1]);
  const template = list[0] ?? ITEM_TEMPLATES[key];
  const objects = !!template && typeof template === 'object';
  const itemName = info.item ?? 'Entry';
  const full = rule.maxItems !== undefined && list.length >= rule.maxItems;
  const listError = errors.get(keyOf(path));
  const headingId = useId();

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set(path, next);
  };
  const remove = (i: number) => set(path, list.filter((_, k) => k !== i));
  const add = () => {
    let item = blankLike(template);
    if (item && typeof item === 'object' && 'id' in (item as object)) item = { ...(item as object), id: newId(key === 'people' ? 'person' : 'item') };
    set(path, [...list, item]);
  };

  const controls = (i: number, name: string) => (
    <div className="item-tools">
      <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${name} up`} title="Move up">
        ↑
      </button>
      <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${name} down`} title="Move down">
        ↓
      </button>
      <button type="button" className="icon-btn danger" onClick={() => remove(i)} aria-label={`Remove ${name}`} title="Remove">
        ✕
      </button>
    </div>
  );

  return (
    <section className={`list ${objects ? 'list-objects' : 'list-texts'}`} data-path={keyOf(path)} aria-labelledby={headingId}>
      <h4 className="list-title" id={headingId}>
        {labelFor(path)}
        {(rule.minItems ?? 0) > 0 && <span className="req"> *</span>}
      </h4>
      {info.help && <p className="help">{info.help}</p>}
      {list.length === 0 && <p className="empty">None yet. Nothing is shown on the site.</p>}
      <ol className="items">
        {list.map((_, i) => {
          const name = `${itemName.toLowerCase()} ${i + 1}`;
          const itemPath = [...path, i];
          if (!objects) {
            return (
              <li key={i} className="item item-text">
                <TextField path={itemPath} label={`${itemName} ${i + 1}`} />
                {controls(i, name)}
              </li>
            );
          }
          return (
            <li key={(list[i] as { id?: string }).id ?? i} className="item item-object">
              <div className="item-head">
                <span className="item-name">
                  {itemName} {i + 1}
                </span>
                {controls(i, name)}
              </div>
              <Fields path={itemPath} />
            </li>
          );
        })}
      </ol>
      {listError && <p className="error">{listError}</p>}
      <button type="button" className="btn btn-add" onClick={add} disabled={full}>
        + {info.add ?? `Add ${itemName.toLowerCase()}`}
      </button>
      {full && <span className="help inline"> At most {rule.maxItems}.</span>}
    </section>
  );
}
