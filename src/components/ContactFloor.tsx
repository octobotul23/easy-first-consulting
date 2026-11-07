import { useId, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import type { SiteContent } from '../content';
import { useCopyrightTaps } from '../hooks/useAdminGesture';
import { useFlowReveal } from '../hooks/useFlowReveal';
import { useLift, type LiftMode } from '../state/elevator';

interface Props {
  content: SiteContent;
  index: number;
  level: number;
  mode: LiftMode;
}

const delay = (i: number) => ({ '--i': i }) as CSSProperties;
const tel = (phone: string) => phone.replace(/[^\d+]/g, '');

/** Floor 9 — Office 906: company details and the contact form. */
export function ContactFloor({ content, index, level, mode }: Props) {
  const ref = useRef<HTMLElement>(null);
  const open3d = useLift((s) => s.openStop === index);
  const seen = useFlowReveal(ref, mode === 'flow');
  const open = mode === '3d' ? open3d : seen;
  const onCopyright = useCopyrightTaps();
  const { contact, company, common } = content;
  const services = content.floors.filter((f) => f.visible).map((f) => f.label);

  return (
    <article ref={ref} className={`contact-panel contact-${mode} ${open ? 'is-open' : ''}`}>
      <div className="panel-card contact-card">
        <div className="contact-grid">
          <div className="contact-info">
            <p className="reveal panel-kicker" style={delay(0)}>
              <span className="floor-no">
                {common.floorWord} {level}
              </span>
              <span className="sep" aria-hidden="true" />
              <span data-edit="contact.kicker">{contact.kicker}</span>
            </p>
            <h2 id="contact-title" className="reveal panel-title" style={delay(1)} data-edit="contact.title">
              {contact.title}
            </h2>
            <p className="reveal panel-intro" style={delay(2)} data-edit="contact.intro">
              {contact.intro}
            </p>

            <dl className="reveal contact-list" style={delay(3)}>
              <div>
                <dt data-edit="contact.addressLabel">{contact.addressLabel}</dt>
                <dd>
                  <address>
                    {company.address.map((line, i) => (
                      <span key={i} className="block" data-edit={`company.address.${i}`}>
                        {line}
                      </span>
                    ))}
                  </address>
                  {company.mapUrl && (
                    <a className="text-link" href={company.mapUrl} target="_blank" rel="noopener noreferrer">
                      {contact.mapLabel}
                    </a>
                  )}
                </dd>
              </div>
              <div>
                <dt data-edit="contact.phoneLabel">{contact.phoneLabel}</dt>
                <dd>
                  <a className="text-link strong" href={`tel:${tel(company.phone)}`} data-edit="company.phone">
                    {company.phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt data-edit="contact.websiteLabel">{contact.websiteLabel}</dt>
                <dd>
                  <a className="text-link" href={company.website} target="_blank" rel="noopener" data-edit="company.website">
                    {company.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                </dd>
              </div>
            </dl>

            <ul className="reveal people" style={delay(4)}>
              {company.people.map((p, i) => (
                <li key={p.id || i}>
                  <span className="person-role" data-edit={`company.people.${i}.role`}>
                    {p.role}
                  </span>
                  <span className="person-name" data-edit={`company.people.${i}.name`}>
                    {p.name}
                  </span>
                  <a className="text-link" href={`mailto:${p.email}`} data-edit={`company.people.${i}.email`}>
                    {p.email}
                  </a>
                  {p.bio && (
                    <p className="person-bio" data-edit={`company.people.${i}.bio`}>
                      {p.bio}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="reveal" style={delay(3)}>
            <ContactForm content={content} services={services} />
          </div>
        </div>

        <p className="contact-foot">
          {/* Five taps on © open the admin panel (see README). */}
          <span className="copy-mark" onClick={onCopyright}>
            ©
          </span>{' '}
          {new Date().getFullYear()} <span data-edit="common.copyright">{common.copyright}</span>
        </p>
      </div>
    </article>
  );
}

/* ---------- The form ---------- */

type Field = 'name' | 'company' | 'email' | 'phone' | 'service' | 'message';
type Values = Record<Field | 'website', string>;
type Status = 'idle' | 'sending' | 'sent' | 'failed' | 'mailto';

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
const PHONE = /^[+\d\s().-]{6,24}$/;
const EMPTY: Values = { name: '', company: '', email: '', phone: '', service: '', message: '', website: '' };

function ContactForm({ content, services }: { content: SiteContent; services: string[] }) {
  const t = content.contact.form;
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [status, setStatus] = useState<Status>('idle');

  const check = (v: Values) => {
    const e: Partial<Record<Field, string>> = {};
    if (v.name.trim().length < 2) e.name = t.errorName;
    if (!EMAIL.test(v.email.trim())) e.email = t.errorEmail;
    if (v.phone.trim() && !PHONE.test(v.phone.trim())) e.phone = t.errorPhone;
    if (v.message.trim().length < 10) e.message = t.errorMessage;
    return e;
  };

  const set = (k: Field | 'website', val: string) => {
    const next = { ...values, [k]: val };
    setValues(next);
    if (k !== 'website' && touched[k]) setErrors((old) => ({ ...old, [k]: check(next)[k] }));
  };
  const blur = (k: Field) => {
    setTouched((o) => ({ ...o, [k]: true }));
    if (values[k]) setErrors((old) => ({ ...old, [k]: check(values)[k] }));
  };

  const service = values.service || t.serviceAny;
  const mailto = () => {
    const head = [
      `${t.name}: ${values.name}`,
      values.company ? `${t.company}: ${values.company}` : '',
      `${t.email}: ${values.email}`,
      values.phone ? `${t.phone}: ${values.phone}` : '',
      `${t.service}: ${service}`,
    ].filter(Boolean);
    const body = `${head.join('\n')}\n\n${values.message}`;
    return `mailto:${content.company.formEmail}?subject=${encodeURIComponent(`${service} — ${values.name}`)}&body=${encodeURIComponent(body)}`;
  };

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errs = check(values);
    setErrors(errs);
    setTouched({ name: true, email: true, phone: true, message: true });
    const first = (Object.keys(errs) as Field[])[0];
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    if (values.website) {
      // Hidden field filled in: a bot. Pretend it worked.
      setStatus('sent');
      return;
    }
    const endpoint = content.company.formEndpoint;
    if (!endpoint) {
      window.location.href = mailto();
      setStatus('mailto');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          company: values.company.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          service,
          message: values.message.trim(),
          _subject: `${service} — ${values.name.trim()}`,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('sent');
      setValues(EMPTY);
      setTouched({});
    } catch {
      setStatus('failed');
    }
  };

  const fieldProps = (k: Field) => ({
    id: `${uid}-${k}`,
    name: k,
    value: values[k],
    'aria-invalid': errors[k] ? (true as const) : undefined,
    'aria-describedby': errors[k] ? `${uid}-${k}-err` : undefined,
    onBlur: () => blur(k),
  });
  const err = (k: Field) =>
    errors[k] ? (
      <p id={`${uid}-${k}-err`} className="field-error">
        {errors[k]}
      </p>
    ) : null;
  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <form ref={formRef} className="contact-form" noValidate onSubmit={submit}>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${uid}-name`}>{t.name}</label>
          <input className="input" type="text" autoComplete="name" maxLength={100} required {...fieldProps('name')} onChange={(e) => set('name', e.target.value)} />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor={`${uid}-company`}>
            {t.company} <span className="opt">({t.optional})</span>
          </label>
          <input className="input" type="text" autoComplete="organization" maxLength={120} {...fieldProps('company')} onChange={(e) => set('company', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${uid}-email`}>{t.email}</label>
          <input className="input" type="email" autoComplete="email" inputMode="email" maxLength={160} required {...fieldProps('email')} onChange={(e) => set('email', e.target.value)} />
          {err('email')}
        </div>
        <div className="field">
          <label htmlFor={`${uid}-phone`}>
            {t.phone} <span className="opt">({t.optional})</span>
          </label>
          <input className="input" type="tel" autoComplete="tel" inputMode="tel" maxLength={30} {...fieldProps('phone')} onChange={(e) => set('phone', e.target.value)} />
          {err('phone')}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-service`}>{t.service}</label>
        <select className="input select" {...fieldProps('service')} onChange={(e) => set('service', e.target.value)}>
          <option value="">{t.serviceAny}</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-message`}>{t.message}</label>
        <textarea className="input" rows={4} maxLength={4000} required {...fieldProps('message')} onChange={(e) => set('message', e.target.value)} />
        {err('message')}
      </div>
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set('website', e.target.value)} />
      </div>

      <div className="form-foot">
        <button className="btn-primary" type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? t.sending : t.submit}
          <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
            <path d="M1 5h13M10 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <p className="form-privacy">{t.privacy}</p>
      </div>
      <div className="form-status" role="status" aria-live="polite">
        {hasErrors && <p className="field-error">{t.errorSummary}</p>}
        {status === 'sent' && <p className="ok">{t.success}</p>}
        {status === 'mailto' && <p className="ok">{t.mailtoNote}</p>}
        {status === 'failed' && (
          <p className="field-error">
            {t.failure}{' '}
            <a className="text-link" href={mailto()}>
              {t.failureLink}
            </a>
          </p>
        )}
      </div>
    </form>
  );
}
