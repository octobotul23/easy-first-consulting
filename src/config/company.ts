/**
 * Company and contact details (floor 9). Change them here — or later from the admin panel.
 */
import type { CompanyInfo } from '../content/types.ts';

/**
 * Default address the contact form posts to (JSON). Set VITE_CONTACT_ENDPOINT in a .env file
 * (see .env.example) or later in the admin panel (Company). Empty = the visitor's e-mail app opens.
 */
export const CONTACT_ENDPOINT: string = String(import.meta.env?.VITE_CONTACT_ENDPOINT ?? '').trim();

export const company: CompanyInfo = {
  legalName: 'Easy First Management Consultancies FZCO',
  brand: 'Easy First',
  nameArabic: 'ايزي فرست مانجمنت كونسلتنسيز',
  logo: '/logo.png',
  phone: '+971 50 222 0708',
  website: 'https://easyfirst-ae.com/',
  address: ['Office 906, 9th Floor', 'IRIS Bay Tower, Business Bay', 'Dubai, United Arab Emirates'],
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=IRIS+Bay+Tower+Business+Bay+Dubai',
  formEmail: 'ceo@efcmuae.com',
  formEndpoint: CONTACT_ENDPOINT,
  people: [
    {
      id: 'ceo',
      role: 'CEO',
      name: 'Takwa Aldilaimi',
      email: 'ceo@efcmuae.com',
      bio: 'More than a decade of experience in commodities, particularly oil and gas, with a deep understanding of the complexities of the commodities market.',
    },
    { id: 'chairman', role: 'Chairman', name: 'Sultan Bin Nayef', email: 'chairman@efcmuae.com', bio: '' },
  ],
};

