# stagetime.io — dokumentacja produktu

## Idea

Serwis, w którym **wszyscy widzą dokładnie ten sam timer** (zgodność co do sekundy). To nie zegar
godzinowy, tylko timer pracy i przerw: cykle biegną nieprzerwanie od wspólnego punktu startu, więc każdy, kto wejdzie na stronę, dołącza do już trwającej sesji – jak do pokoju coworkingowego.

## Pojęcia

| Pojęcie | Znaczenie |
|---|---|
| **Pokój** | Kanał z własnym rytmem, np. `20+5` (20 min pracy, 5 min przerwy) albo `55+15`. |
| **Obserwator** | Każdy, kto ma otwartą kartę z pokojem (także niezalogowany). Widzi timer i licznik osób. |
| **Uczestnik** | Osoba zalogowana. Ma postać na wspólnej scenie, może się poruszać i zbierać XP. |
| **XP** | Doświadczenie za czas spędzony w pokoju (zalogowany + aktywna karta). |
| **Postać / sklep** | Awatar, który można rozwijać: elementy kupowane lub odblokowywane poziomami XP. |

## Wymagania funkcjonalne

### Timer (rdzeń)
- Stan timera jest **czystą funkcją** czasu serwera (UTC) i konfiguracji pokoju – brak stanu do
  synchronizowania, więc wszyscy zawsze widzą to samo.
- Klient wyznacza offset względem zegara serwera (`GET /api/time`, próbki wybierane po najmniejszym RTT),
  okresowo synchronizuje ponownie.
- Harmonogram: jeden wspólny punkt startu (`EPOCH_MS` = 2026-01-01 00:00 UTC). Każdy pokój od tej chwili
  odlicza własne cykle (praca + przerwa) w nieskończoność, bez resetów o pełnej godzinie. Cykl pokoju 55+15
  trwa 70 min, więc jego starty nie wypadają o pełnych godzinach – to zamierzone.
- Wyświetlanie: faza (praca/przerwa), pozostały czas, pasek postępu.

### Obecność (presence)
- Licznik osób z aktywną kartą w pokoju (Supabase Realtime Presence).
- Osobno: liczba zalogowanych uczestników.

### Konta i logowanie (Supabase Auth)
- Rejestracja/logowanie (e-mail magic link + później OAuth, np. Google).
- Zalogowanie odblokowuje: postać na scenie, zbieranie XP, sklep.

### Scena i postacie
- Wspólny ekran pokoju, na którym zalogowani widzą nawzajem swoje postacie w czasie rzeczywistym
  (Realtime Broadcast: pozycje x/y, throttling ~10–15 Hz, interpolacja na kliencie).
- Ruch klawiszami / kliknięciem.

### Doświadczenie i sklep
- XP naliczane serwerowo (nie ufamy klientowi): heartbeat co N sekund z aktywnej karty w fazie pracy
  (opcjonalnie mniejsze XP za przerwę), limity antynadużyciowe.
- Poziomy odblokowują przedmioty; część przedmiotów kupowana walutą (monety z XP) – do ustalenia.

## Wymagania niefunkcjonalne
- Hosting: **Vercel**; backend: **Supabase** (Postgres, Auth, Realtime).
- Działanie bez zmiennych Supabase w trybie lokalnym (timer działa, licznik = 1).
- Dokładność synchronizacji: cel ≤ 1 s różnicy między klientami.
- Interfejs po polsku (i18n później).

## Architektura

```
Przeglądarka ──GET /api/time──▶ Next.js (Vercel)   (czas serwera)
     │
     ├── Supabase Auth      (sesje, profile)
     ├── Supabase Realtime  (Presence: liczniki; Broadcast: ruch postaci)
     └── Supabase Postgres  (profiles, xp, items, inventories) + RLS
```

Stack: Next.js (App Router) + TypeScript + Tailwind, `@supabase/supabase-js`.
Kod: `src/lib/timer.ts` (logika, testowana), `src/lib/useServerClock.ts` (synchronizacja),
`src/lib/usePresence.ts` (obecność), `src/components/RoomTimer.tsx`, `src/app/rooms/[slug]`.

## Model danych (docelowo)

- `profiles(id → auth.users, display_name, xp, level, coins, avatar jsonb, created_at)`
- `rooms(slug, name, work_min, break_min)` – na start w kodzie (`src/lib/rooms.ts`), później w bazie
- `items(id, name, kind, price, required_level)`
- `inventory(user_id, item_id, acquired_at)`
- `xp_events(id, user_id, room_slug, amount, created_at)` – log do audytu / antycheat

RLS: użytkownik czyta/edytuje tylko swój profil; XP zmienia wyłącznie funkcja serwerowa (RPC / Edge Function).

## Otwarte pytania
1. Czy pokoje są tylko predefiniowane, czy użytkownicy mogą tworzyć własne (np. `45+15`)?
2. Waluta: czy XP wystarcza, czy osobne monety do sklepu?
3. Czy XP za przerwy, czy tylko za fazę pracy?
4. Styl graficzny postaci (pixel art 2D? kanwa `<canvas>` / PixiJS / Phaser?).
5. Czat lub emotki na scenie?
