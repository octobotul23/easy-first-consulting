/**
 * All texts of the tower, floor by floor (bottom to top).
 * Edit freely: the order of `floors` is the order of the levels (first = floor 1).
 * Floor 9 (contact) is `contact` below; company details are in src/config/company.ts.
 *
 * Tone: this is a financial-sector firm — describe what is done and how,
 * never promise outcomes ("guaranteed", "risk-free", "assured returns").
 */
import type { CommonContent, ContactContent, FloorContent, LobbyContent, NavContent } from './types.ts';

export const lobby: LobbyContent = {
  eyebrow: 'Easy First Management Consultancies · Dubai',
  title: 'Redefining Growth. Powering Opportunities.',
  subtitle:
    'Consultancy and trading across energy, gold, corporate structuring, escrow and digital assets — from Office 906, IRIS Bay Tower, Business Bay.',
  scrollHint: 'Scroll to go up',
  scrollUpHint: 'Scroll up to go up',
  swipeDownHint: 'Swipe down to go up',
  seo: {
    title: 'Easy First Management Consultancies FZCO | Dubai',
    description:
      'Dubai consultancy and trading firm: oil and gas, gold, company formation, investment structuring, escrow and digital assets. Office 906, IRIS Bay Tower, Business Bay.',
  },
};

const noSteps = { label: '', items: [] as string[] };

export const floors: FloorContent[] = [
  {
    id: 'oil-gas',
    visible: true,
    label: 'Oil & Gas',
    kicker: 'Energy & Commodities',
    title: 'Oil & Gas, through verified channels.',
    intro:
      'We work only with verified refineries and suppliers. Every deal follows a documented procedure and independent inspection.',
    facts: [
      { label: 'Products', items: ['EN590', 'Crude oil', 'LNG', 'LPG', 'Kerosene', 'Fuel oil'] },
      { label: 'Terms', items: ['FOB', 'CIF'] },
    ],
    steps: { label: 'Procedure', items: ['LOI', 'ICPO', 'CP', 'SPA', 'MT103 / TT', 'PPOP', 'Q88'] },
    points: [
      'Quantity and quality inspected independently by SGS or Intertek.',
      'Contracts within UAE compliance, with DIFC or Dubai Courts jurisdiction available.',
      'One team coordinates logistics, documents and communication, from vessel nomination to final discharge.',
    ],
    blocks: [],
    note: '',
    seo: {
      title: 'Oil & Gas Trading — EN590, Crude, LNG, LPG | Easy First Dubai',
      description:
        'Oil and gas from verified refineries and suppliers: EN590, crude oil, LNG, LPG, kerosene and fuel oil on FOB or CIF terms, inspected by SGS or Intertek.',
    },
  },
  {
    id: 'trading',
    visible: true,
    label: 'Gold & Fuels',
    kicker: 'Trading & Distribution',
    title: 'Trading and distribution, documented end to end.',
    intro:
      'Physical gold and refined fuels, sourced from verified counterparties and delivered under clear contractual terms.',
    facts: [{ label: 'Commodities', items: ['Physical gold', 'Refined fuels'] }],
    steps: noSteps,
    points: [
      'Counterparty due diligence before any commitment.',
      'Independent assay and inspection at the agreed point of delivery.',
      'A documented chain of custody, from origin to final delivery.',
    ],
    blocks: [],
    note: '',
    seo: {
      title: 'Gold & Fuel Trading and Distribution | Easy First Dubai',
      description:
        'Physical gold and refined fuels traded and distributed through verified counterparties, with independent inspection and a documented chain of custody.',
    },
  },
  {
    id: 'corporate-advisory',
    visible: true,
    label: 'Corporate Advisory',
    kicker: 'Formation · Licensing · Banking',
    title: 'Corporate Advisory',
    intro:
      'Company formation, licensing and structuring across jurisdictions — set up with the regulator in mind from day one.',
    facts: [],
    steps: noSteps,
    points: [
      'Company formation and licensing in the UAE and other jurisdictions.',
      'Corporate structures that fit how the business actually operates.',
      'Opening physical corporate bank accounts.',
      'Clear guidance on regulatory and reporting requirements.',
    ],
    blocks: [],
    note: '',
    seo: {
      title: 'Company Formation, Licensing & Bank Accounts in Dubai | Easy First',
      description:
        'Company formation, licensing and structuring across jurisdictions, opening physical corporate bank accounts and guidance on regulatory requirements.',
    },
  },
  {
    id: 'investment-structuring',
    visible: true,
    label: 'Investment Structuring',
    kicker: 'Joint ventures · Partnerships',
    title: 'Investment Structuring',
    intro:
      'Frameworks for joint ventures, partnerships and large-scale investments, so every party knows where it stands.',
    facts: [],
    steps: noSteps,
    points: [
      'Legal frameworks for joint ventures and partnerships.',
      'Financial safeguards built into large-scale investments.',
      'Compliance mechanisms designed in from the start.',
    ],
    blocks: [],
    note: '',
    seo: {
      title: 'Investment Structuring, Joint Ventures & Partnerships | Easy First Dubai',
      description:
        'Joint ventures, partnerships and large-scale investments structured with legal frameworks, financial safeguards and compliance mechanisms.',
    },
  },
  {
    id: 'financial-security',
    visible: true,
    label: 'Financial Security',
    kicker: 'Escrow · Fund management',
    title: 'Financial Security',
    intro:
      'Fund management and escrow solutions under UAE law, so funds move only when the agreed conditions are met.',
    facts: [],
    steps: noSteps,
    points: [
      'Escrow arrangements under UAE law.',
      'Fund management with clearly defined release conditions.',
      'DIFC or Dubai Courts jurisdiction when required.',
      'Large-scale settlements handled within documented, secure frameworks.',
    ],
    blocks: [],
    note: '',
    seo: {
      title: 'Escrow & Fund Management under UAE Law | Easy First Dubai',
      description:
        'Fund management and escrow solutions under UAE law, with DIFC or Dubai Courts jurisdiction when required.',
    },
  },
  {
    id: 'digital-assets',
    visible: true,
    label: 'Digital Assets',
    kicker: 'Digital Asset Exchange · OTC',
    title: 'Digital Assets',
    intro:
      'Institutional-scale OTC buying and selling of digital assets, with due diligence and confidentiality at every step.',
    facts: [{ label: 'Assets', items: ['Bitcoin', 'Ethereum', 'Stablecoins'] }],
    steps: noSteps,
    points: [
      'Over-the-counter execution for institutional volumes.',
      'Counterparty due diligence before settlement.',
      'Confidential handling of every transaction.',
      'Aligned with UAE financial regulations.',
    ],
    blocks: [],
    note: '',
    seo: {
      title: 'Institutional OTC Desk — Bitcoin, Ethereum, Stablecoins | Easy First Dubai',
      description:
        'Institutional-scale OTC buying and selling of Bitcoin, Ethereum and stablecoins, with due diligence and confidentiality.',
    },
  },
  {
    id: 'vision-mission',
    visible: true,
    label: 'Vision & Mission',
    kicker: 'Who we are',
    title: 'Vision & Mission',
    intro:
      'A Dubai-based consultancy and trading firm, working across energy, commodities and investments with international expertise and legal compliance.',
    facts: [],
    steps: noSteps,
    points: [],
    blocks: [
      {
        heading: 'Vision',
        text: 'To be a trusted global partner in energy and commodities, known for the ability to anticipate, structure and secure complex international transactions, with high standards of integrity, performance and resilience.',
      },
      {
        heading: 'Mission',
        text: 'To give our clients practical, secure and results-driven solutions. We work across oil, gas and corporate matters with precision and discipline, and every transaction is backed by compliance and transparency.',
      },
      { heading: 'Values', text: 'Integrity · Excellence · Collaboration · Innovation · Client satisfaction' },
    ],
    note: '',
    seo: {
      title: 'Vision & Mission | Easy First Management Consultancies',
      description:
        'Easy First is a Dubai-based consultancy and trading firm in energy, commodities and investments. Our vision, mission and values: integrity, excellence, collaboration, innovation.',
    },
  },
  {
    id: 'long-term',
    visible: true,
    label: 'Long-Term Success',
    kicker: 'How we work',
    title: 'Positioning for Long-Term Success',
    intro:
      'More than a consultancy or a trading house: one platform connecting energy, corporate solutions and digital assets — a gateway between traditional commodities and the future of finance.',
    facts: [],
    steps: noSteps,
    points: [
      'Discipline combined with innovation.',
      'Full compliance in today’s transactions, while preparing for tomorrow’s opportunities.',
      'Structures and partnerships designed to outlast market cycles.',
      'A Dubai base with reach into international markets.',
    ],
    blocks: [
      { heading: 'Reshaping Trade', text: 'Oil, gas and energy deals executed with transparency and trust.' },
      { heading: 'Bridging Worlds', text: 'Working where commodities, corporate advisory and digital assets meet.' },
    ],
    note: '',
    seo: {
      title: 'Long-Term Partnerships | Easy First Management Consultancies',
      description:
        'One platform connecting energy, corporate solutions and digital assets: a gateway between traditional commodities and the future of finance.',
    },
  },
];

export const contact: ContactContent = {
  label: 'Office 906',
  kicker: 'Contact',
  title: 'Welcome to Office 906.',
  intro: 'Tell us what you are working on. A member of our team will get back to you by e-mail or phone.',
  addressLabel: 'Address',
  phoneLabel: 'Phone',
  websiteLabel: 'Website',
  mapLabel: 'Open in Maps',
  form: {
    name: 'Full name',
    company: 'Company',
    email: 'E-mail',
    phone: 'Phone',
    service: 'Service of interest',
    serviceAny: 'General enquiry',
    message: 'Message',
    optional: 'optional',
    submit: 'Send message',
    sending: 'Sending…',
    success: 'Thank you — your message has been sent.',
    failure: 'The message could not be sent right now.',
    failureLink: 'Send it by e-mail instead',
    mailtoNote: 'Your e-mail app will open with the message ready to send.',
    privacy: 'We use your details only to reply to this enquiry.',
    errorName: 'Please enter your name.',
    errorEmail: 'Please enter a valid e-mail address, for example name@company.com.',
    errorPhone: 'Use digits, spaces and + ( ) - only, for example +971 50 000 0000.',
    errorMessage: 'Please write a short message (at least 10 characters).',
    errorSummary: 'Please check the highlighted fields.',
  },
  seo: {
    title: 'Contact — Office 906, IRIS Bay Tower, Business Bay | Easy First',
    description:
      'Visit or contact Easy First Management Consultancies FZCO: Office 906, 9th Floor, IRIS Bay Tower, Business Bay, Dubai. Phone +971 50 222 0708.',
  },
};

export const nav: NavContent = {
  services: 'Services',
  about: 'About',
  contact: 'Contact',
};

export const common: CommonContent = {
  floorWord: 'Floor',
  lobbyLabel: 'Lobby',
  cta: 'Talk to us',
  liftPanel: 'Elevator',
  goingUp: 'Going up',
  goingDown: 'Going down',
  skipLink: 'Skip to content',
  copyright: 'Easy First Management Consultancies FZCO. All rights reserved.',
};
