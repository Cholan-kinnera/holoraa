import type { Metadata } from 'next';
import { HoloraaApp } from '@/components/HoloraaApp';

export const metadata: Metadata = {
  title: 'Holoraa — Interactive Prototype & Workspace',
  description: 'One quiet place for the people who matter. Modular Next.js implementation of Holoraa.',
};

export const dynamic = 'force-dynamic';

export default function PrototypePage() {
  return <HoloraaApp />;
}
