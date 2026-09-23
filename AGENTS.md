<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Architektura Projektu: stan na 2026-09-23

Ta appka to coworking z timerem Pomodoro (nie gra RPG). Repo **nie jest** monorepo — nie ma
`/client`, `/server`, `/shared`, nie ma Colyseus, nie ma AI potworów ani FSM. Poniżej faktyczny
podział, jaki dziś istnieje w kodzie.

### `src/` — Next.js (App Router), warstwa prezentacji + część danych
- Frontend hostowany typowo na Vercel; `src/app/api/*` to bezstanowe route handlery Next.js.
- `src/components/RoomStage.tsx` — scena pokoju: rysowanie, input, i (za flagą, patrz niżej)
  klient sieciowy do `realtime-server`.
- `src/lib/supabaseAdmin.ts` — jedyne miejsce w Next.js używające `SUPABASE_SERVICE_ROLE_KEY`
  (bypass RLS), wołane wyłącznie przez `src/app/api/internal/positions/route.ts` na potrzeby
  `realtime-server` (zapis/odczyt pozycji w imieniu gracza, którego sesji Next.js nie ma).
- `src/app/api/realtime/token/route.ts` — mintuje krótkotrwały, podpisany token wejścia
  (`@realtime-shared/entryToken`) na podstawie sesji Supabase Auth zalogowanego użytkownika;
  `realtime-server` ufa wyłącznie temu tokenowi, nigdy danym podanym wprost przez klienta.
- Supabase pozostaje: Auth (konta/sesje), Postgres (profile, XP, monety, `player_positions`,
  czat), i nadal obsługuje presence oraz historię czatu przez Realtime — to się nie zmieniło.

### `realtime-server/` — autorytatywny serwer WebSocket (Node + `ws`), deploy na Fly.io
- Osobny pakiet npm w tym samym repo (własny `package.json`, `Dockerfile`, `fly.toml`; appka Fly
  nazywa się `studyquest`). Nie Colyseus — świadomie własny, minimalny WebSocket server.
- `realtime-server/shared/` (`types.ts`, `constants.ts`, `entryToken.ts`, `physics.ts`) to
  jedyne "shared" w tym repo — importowane z `src/` przez alias `@realtime-shared/*` w
  `tsconfig.json`, nie przez osobny pakiet workspace.
- **Odpowiada za, jako jedyne źródło prawdy (serwer, nie klient, decyduje):**
  - ruch: pozycję gracza liczy z surowego inputu (`dx`/`dy`), waliduje granice mapy;
  - roll/dash: serwer sam liczy kierunek i pilnuje cooldownów, klient tylko wysyła żądanie;
  - pociski/uderzenia wręcz (rzut kulą, fist swing): spawn, fizyka, i **jedna** decyzja "kto kogo
    trafił", rozgłaszana identycznie wszystkim graczom w pokoju;
  - reconnect + grace period (12 s) po zerwaniu WebSocketu;
  - okresowy zapis pozycji do Postgresa przez `src/app/api/internal/positions`;
  - limity antynadużyciowe: wiadomości/s, połączenia/IP, gracze/pokój, pociski/gracz.
- To jest **PvP kosmetyczne między prawdziwymi graczami**: HP (`MAX_HP` w
  `realtime-server/shared/constants.ts`, dmg/respawn/immunity w `server.ts`) **już istnieje** —
  obrażenia liczą się tylko poza lobby (`isLobbyRoom` w `server.ts` pomija odejmowanie HP). Brak
  tu za to ekonomii (transakcyjnej — dziś jest tylko `coins`) i nagród za trafienie; nie ma tu, i
  nie jest planowane, AI/FSM/przeciwników sterowanych komputerowo.

### Decyzja (2026-09-23): Colyseus przy dodaniu ekonomii / AI przeciwników
HP już istnieje (patrz wyżej) i nie wymagało Colyseusa — poszło jako pola w `Conn`
(`realtime-server/src/server.ts`, `hp`/`respawnAt`/`immuneUntil`) i logika w tej samej pętli tick,
dokładnie ten sam wzorzec co dziś dla ruchu/walki (patrz sekcja `realtime-server/` wyżej). Ta sama
zasada dotyczy ekonomii (transakcyjnej, nie tylko `coins` jak dziś) i AI przeciwników — **same w
sobie nie wymagają i nie uzasadniają** przejścia na Colyseus. Colyseus rozwiązuje dwa problemy,
których to repo dziś nie ma: matchmaking wielu pokoi i binarny delta-encoding stanu
(`@colyseus/schema`) zamiast pełnego stanu jako JSON co broadcast.
Sygnał, że warto to zrewidować: `BROADCAST_MS` wysyła pełny stan pokoju (nie diff) — to zaczyna
realnie kosztować pasmo dopiero przy dużej liczbie encji (gracze + przeciwnicy + stan ekonomii) na
pokój; przy dzisiejszym `MAX_PLAYERS_PER_ROOM` = 50 to nie jest wąskie gardło. Nie proponuj migracji
na Colyseus tylko dlatego, że pojawia się ekonomia/AI — dopiero przy konkretnym, zmierzonym
problemie z pasmem albo realną potrzebą matchmakingu wielu pokoi.

**Konkretne progi, przy których Colyseus staje się zasadny (rewizja tej decyzji, nie automat):**
- Stały ruch w stronę >50 graczy w jednym pokoju (dziś to twardy limit `MAX_PLAYERS_PER_ROOM` w
  `realtime-server/src/server.ts`) — podniesienie go w górę zamiast pozostania przy małych grupach
  coworkingowych, dla których ten limit został ustawiony.
- Wiele jednocześnie żywych pokoi z realną potrzebą matchmakingu (przydzielanie gracza do pokoju,
  balansowanie obciążenia między pokojami/instancjami) — dziś `rooms` to zwykła `Map` po
  `roomSlug`, bez żadnego mechanizmu wyboru/tworzenia pokoju za gracza.
- Oba te warunki razem (dużo pokoi × dużo graczy na pokój) to sytuacja, w której ręczne broadcasty
  pełnego JSON-a i ręczne zarządzanie `Map<roomSlug, Set<Conn>>` przestają się skalować i warto
  wtedy realnie rozważyć Colyseus (albo inny framework tej klasy) zamiast dalej rozbudowywać
  własny serwer.

### Flaga rolloutu
Całość powyższego (ruch + walka na serwerze) działa **tylko** gdy `NEXT_PUBLIC_REALTIME_SERVER_URL`
jest ustawione w `src/`. Bez tej zmiennej `RoomStage.tsx` wraca do starego zachowania: ruch i
"walka" liczone w 100% lokalnie u każdego klienta i rozgłaszane peer-to-peer przez Supabase
Broadcast, bez żadnej wspólnej, autorytatywnej prawdy. Kierunek docelowy (ustalony
2026-09-23): pełne przejście na wariant z `realtime-server` wszędzie, stopniowo wygaszając
zależność od Vercel jako miejsca liczenia stanu rozgrywki — klient ma z czasem odpowiadać
wyłącznie za wygląd (rendering/animacje), nie za wynik.

## Instrukcje dla Asystenta AI przy generowaniu kodu w tym repo
1. Nie zakładaj `/client` `/server` `/shared` ani Colyseus — to nie istnieje w tym repo.
2. Nową mechanikę ruchu/walki/współdzielonego stanu zacznij od typów/stałych w
   `realtime-server/shared/`, potem logika w `realtime-server/src/server.ts`, na końcu
   `src/components/RoomStage.tsx` wyłącznie jako prezentacja tego, co przyszło z serwera.
3. Nic, co dotyczy AI przeciwników/FSM potworów — to nie ma zastosowania w tym repo i nie jest
   planowane.
4. Jeśli ktoś poprosi o zmiany w HP albo o dodanie ekonomii/AI przeciwników, nie proponuj przy tej
   okazji migracji na Colyseus — patrz "Decyzja (2026-09-23)" wyżej o tym, kiedy to faktycznie
   byłoby zasadne.