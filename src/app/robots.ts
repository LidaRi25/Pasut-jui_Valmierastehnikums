import type { MetadataRoute } from 'next';

// Iekšēja sistēma — meklētājprogrammām nekas nav indeksējams
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
