# Plan implementacji

Zasada: każdy etap kończy się działającą, uruchamialną aplikacją.

## Etap 0 — Szkielet ✅
- [x] Next.js + TypeScript + Tailwind, repo git w katalogu głównym
- [x] Logika timera (czysta funkcja) + testy (`npm test`)
- [x] `GET /api/time` + synchronizacja zegara klienta
- [x] Strona główna z listą pokoi, strona pokoju `/rooms/[slug]` z timerem
- [x] Licznik obserwujących (Supabase Presence, w trybie lokalnym = 1)

## Etap 1 — Supabase i obserwatorzy
- [ ] Założyć projekt Supabase, uzupełnić `.env.local` (wg `.env.example`)
- [ ] Zweryfikować Presence między dwiema kartami
- [ ] Deploy na Vercel + zmienne środowiskowe
- [ ] Sygnały UX: dźwięk/powiadomienie przy zmianie fazy, tytuł karty z czasem

## Etap 2 — Logowanie
- [ ] `@supabase/ssr`, magic link (e-mail), strona `/login`, callback
- [x] Tabela `profiles` + trigger tworzący profil po rejestracji, RLS (`supabase/migrations/0002_profiles.sql`)
- [x] Nagłówek z stanem sesji; licznik zalogowanych vs. obserwatorów (Presence z metadanymi)
- [x] Globalny licznik obecności w stopce (wszystkie pokoje razem)
- [x] Czat pokoju: tabela `messages` + RLS (`supabase/migrations/0001_messages.sql`), pisać mogą zalogowani
- [x] Zmiana nicku w menu profilu — obowiązuje też wstecz, w całej historii czatu

## Etap 3 — Scena i ruch postaci
- [ ] Komponent sceny (`<canvas>`), prosta postać (kółko/sprite)
- [ ] Ruch (WASD / klik), Realtime Broadcast pozycji, interpolacja
- [ ] Tylko zalogowani mogą się poruszać; obserwatorzy widzą

## Etap 4 — XP
- [ ] Heartbeat z aktywnej karty → RPC naliczające XP (walidacja serwerowa, limity)
- [ ] Poziomy, pasek XP w UI, `xp_events`

## Etap 5 — Postać, przedmioty, sklep
- [ ] Tabele `items`, `inventory`; katalog przedmiotów
- [ ] Odblokowywanie poziomami / zakup, ekwipowanie na postaci

## Etap 6 — Rozwój
- [ ] Pokoje tworzone przez użytkowników, ranking, emotki, moderacja czatu, strefy czasowe, PWA

## Zależności / ryzyka
- Presence i Broadcast mają limity planu darmowego Supabase – sprawdzić przy większym ruchu.
- Sync czasu: przeglądarki w tle throttlują timery; stan zawsze liczony z zegara, nie z odliczania.
- Antynadużycia XP (wiele kart/botów): limity na użytkownika, jedna aktywna sesja na konto.
