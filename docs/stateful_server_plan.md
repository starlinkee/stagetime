# Plan: własny serwer stanowy (Fly.io) zamiast Supabase Realtime dla części real-time

## Status i kontekst

Ten dokument opisuje **hipotetyczną, opcjonalną migrację**, nie zatwierdzony plan wdrożenia.
Napisany po tym, jak okazało się, że `AGENTS.md` opisuje architekturę monorepo
(`/client` + `/server` + `/shared`, Colyseus, FSM potworów), która **nie istnieje w tym
repozytorium**. `AGENTS.md` wymaga aktualizacji/usunięcia niezależnie od tego, czy ten plan
zostanie kiedykolwiek zrealizowany — inaczej wprowadza w błąd każdą kolejną sesję pracy nad
kodem.

### Jak wygląda architektura dzisiaj (`docs/PRODUKT.md`, kod w `src/`)

- Next.js (App Router) na Vercel, funkcje API bezstanowe (`src/app/api/*`).
- Supabase = Postgres (dane trwałe: konta, monety, XP, wiadomości, pozycje) + Auth + Realtime
  (zarządzany serwis WebSocket: presence + broadcast pozycji + `postgres_changes` dla czatu).
- Timer jest **celowo czystą funkcją czasu** (`src/lib/timer.ts`) — brak stanu do
  synchronizowania, to świadoma decyzja projektowa, którą warto zachować niezależnie od
  reszty tego planu.
- Pozycje graczy: klient zapisuje sam swoją pozycję do `player_positions` (RLS pilnuje, że
  tylko swoją) i rozgłasza ją innym przez Realtime Broadcast — **serwer dziś nie waliduje
  ruchu ani nie liczy kolizji**.
- Ekonomia (monety, koszt zakupów) liczona w funkcjach `security definer` w Postgresie.

### Po co w ogóle to rozważać

Głównie, jeśli/gdy pojawi się potrzeba **serwerowej walidacji** czegoś w czasie rzeczywistym,
czego dziś nie ma (np. żeby klient nie mógł sam sobie wpisać dowolnej pozycji/XP), albo gdy
Supabase Realtime przestanie wystarczać pod względem opóźnień/kosztów przy większej skali.
Jeśli żadna z tych potrzeb nie występuje — obecna architektura (bezstanowa, zarządzana) jest
prostsza w utrzymaniu i **nie warto** tej migracji robić prewencyjnie.

## Zakres migracji

Co się przenosi z Supabase Realtime na własny serwer:
- obecność w pokoju (presence),
- pozycje/ruch graczy w czasie rzeczywistym, tym razem **walidowane serwerowo**,
- (opcjonalnie, później) wszelka przyszła logika wymagająca autorytatywnego stanu współdzielonego.

Co **zostaje** w Postgresie bez zmian:
- konta/auth (Supabase Auth),
- trwałe saldo monet, XP, poziomy, historia zakupów — serwer stanowy tylko *zgłasza* zdarzenia
  (np. "użytkownik spędził N sekund w pokoju"), Postgres nadal jest księgą trwałą,
- czat i jego historia (może zostać na `postgres_changes`, o ile opóźnienie nie przeszkadza).

## Kroki

### Krok 0 — potwierdzić, że to jest potrzebne
Zanim cokolwiek zaczniecie: spisać konkretny problem, którego Supabase Realtime nie rozwiązuje
(opóźnienie? koszt? brak walidacji serwerowej ruchu?). Bez tego migracja to koszt bez
mierzalnej korzyści.

### Krok 1 — zaprojektować typy stanu (odpowiednik dzisiejszego `/shared`)
- Nowy pakiet/katalog, np. `src/realtime-shared/`, z typami: `RoomState`, `PlayerState`
  (`x, y, dir, userId`), `RoomEvent` (join/leave/move).
- Dodać pole `schemaVersion` do stanu od samego początku — patrz Krok 7 (versioning).

### Krok 2 — zbudować minimalny silnik pokoju w Node
- Nowy serwis, osobny od Next.js (np. `realtime-server/`), Node + biblioteka do pokoi
  (Colyseus albo lekki własny WebSocket + `Map` w pamięci — Colyseus daje matchmaking i
  reconnect "za darmo", więc mniej własnej roboty).
- Jeden proces trzyma `Map<roomId, RoomState>` w pamięci, tick loop (np. 10–20 Hz) do
  przetwarzania ruchu i rozgłaszania delt do klientów w tym pokoju.
- Serwer **waliduje** ruch (np. maks. prędkość, granice mapy) zamiast ufać klientowi.

### Krok 3 — matchmaking / routing pokoi
- Endpoint (część tego samego serwisu albo osobny), który na żądanie "dołącz do pokoju
  `20-5-1`" zwraca adres instancji + krótkotrwały token wejścia (podobny do dzisiejszego
  `roomEntryTicket.ts`, ale dla WebSocketu, nie HTTP).
- Limit graczy per pokój ustawiany jawnie w konfiguracji (`ROOMS` w `src/lib/rooms.ts` już ma
  strukturę, którą można rozszerzyć o `maxPlayers`).

### Krok 4 — deploy na Fly.io
- Dockerfile dla `realtime-server/`.
- `fly.toml`: `min_machines_running` dopasowane tak, żeby Machines z aktywnymi pokojami nie
  były usypiane w trakcie sesji; `[[services]]` z portem WebSocket.
- Region(y) blisko użytkowników — dla coworkingowego use case pewnie wystarczy 1 region na
  start.

### Krok 5 — sticky routing
- Skonfigurować Fly Proxy / nagłówki `fly-replay`, żeby klient zawsze trafiał na Machine
  trzymającą jego pokój (patrz wyjaśnienie w rozmowie: 1 pokój = 1 Machine, matchmaker
  decyduje przy wejściu).
- Reconnect: klient musi umieć się ponownie połączyć po zerwaniu WebSocketu (token
  reconnection, timeout na "osierocone" miejsce w pokoju).

### Krok 6 — most do Postgresa (trwałość)
- Serwer real-time NIE zastępuje Postgresa — okresowo (albo przy evencie typu "gracz wyszedł")
  wysyła zapis do Supabase (np. `player_positions` do "ostatnia znana pozycja", zdarzenia XP/
  monet przez istniejące funkcje `security definer`).
- Zdecydować: czy serwer real-time łączy się do Postgresa bezpośrednio (service role), czy
  przez wewnętrzne HTTP API w Next.js — prościej trzymać całą logikę dostępu do bazy w jednym
  miejscu (Next.js już ją ma).

### Krok 7 — strategia wersjonowania stanu
- Każdy stan w RAM ma `schemaVersion`.
- Deploy nowej wersji: **domyślnie strategia "deploy przy pustym pokoju"** — najprostsza,
  pasuje do krótkich sesji coworkingowych (ludzie i tak wchodzą/wychodzą co 20–55 min).
- Jeśli w przyszłości okaże się to zbyt uciążliwe (częste deploye), rozważyć graceful drain
  (nowe pokoje na nowej wersji, stare dogasają) — ale nie budować tego z góry, dopóki nie
  boli.

### Krok 8 — zmiany po stronie klienta
- Klient przestaje pisać bezpośrednio do `player_positions` — zamiast tego wysyła input
  (kierunek ruchu) do serwera real-time i renderuje to, co serwer odeśle (zgodnie z zasadą
  "klient tylko odtwarza animacje", którą już macie zapisaną, tylko dziś nieegzekwowaną w
  kodzie).
- Presence: przełączyć `usePresence.ts` z kanału Supabase na kanał nowego serwera (albo
  zostawić presence na Supabase, jeśli tylko pozycje/ruch mają się przenieść — to można
  rozdzielić).
- Reconnect UI: pokazać stan "łączenie ponownie" zamiast czyścić scenę przy krótkiej przerwie
  w połączeniu.

### Krok 9 — obserwowalność
- Metryki per-Machine: liczba aktywnych pokoi, graczy, RAM/CPU, długość tick loopa.
- Alarmy na restart Machine z aktywnymi graczami (sygnał, że strategia z Kroku 7 nie
  wystarcza).

### Krok 10 — stopniowy rollout
- Zacząć od jednego typu pokoju (np. tylko `timer`/stopwatch, najmniejszy ruch) jako pilotaż,
  zanim obejmie wszystkie warianty Pomodoro.
- Feature flag / procent ruchu, możliwość szybkiego powrotu do Supabase Realtime, dopóki nowy
  serwis się nie ustabilizuje.

## Co NIE jest częścią tego planu
- Migracja Auth — zostaje Supabase Auth.
- Migracja trwałego przechowywania monet/XP — zostaje Postgres.
- Jakakolwiek logika AI/walki — w tej aplikacji jej nie ma i nie jest przedmiotem tego
  dokumentu (to `AGENTS.md` opisuje nieistniejącą grę RPG — do wyjaśnienia/poprawy osobno).

## Otwarte pytania do rozstrzygnięcia przed startem
1. Czy realny problem (patrz Krok 0) w ogóle uzasadnia ten koszt wdrożeniowy i operacyjny?
2. Colyseus czy własny, minimalny WebSocket server — ile funkcji z Colyseus faktycznie się
   wykorzysta?
3. Gdzie mieszka `realtime-server/` — osobny deploy w tym samym repo, czy osobne repo?
4. Kto/co jest właścicielem prawdy o saldzie monet w razie konfliktu między serwerem real-time
   a funkcją Postgresa (kolejność zapisów, idempotencja zdarzeń)?
