# stagetime.io

Wspólny timer pracy i przerw: wszyscy w pokoju widzą ten sam czas co do sekundy.

- Dokumentacja produktu: [docs/PRODUKT.md](docs/PRODUKT.md)
- Plan implementacji: [docs/PLAN.md](docs/PLAN.md)

## Uruchomienie

```bash
npm install
cp .env.example .env.local   # opcjonalnie: klucze Supabase (bez nich licznik obserwujących = 1)
npm run dev                  # http://localhost:3000
npm test                     # testy logiki timera
```

Stack: Next.js, TypeScript, Tailwind, Supabase, Vercel.
