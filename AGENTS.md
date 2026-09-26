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
  - roll: serwer sam liczy kierunek i pilnuje cooldownu, klient tylko wysyła żądanie;
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

### Deploy: Vercel jest już podpięty pod `git push` — nie wołaj `vercel --prod` ręcznie
Projekt Vercel ma **aktywną integrację z GitHubiem** na branchu `main`: sam `git push origin main`
już wywołuje deploy na produkcję (alias `stagetime-git-main-…`). Ręczne odpalenie `vercel --prod`
po takim pushu ściga się z tym automatycznym deployem o ten sam `deploymentId` i **zawsze przegrywa**.

Powtarzający się błąd, który to sygnalizuje:
```
A deployment with the user-configured deploymentId "<12-znakowy-sha>" already exists in this
project. User-configured deployment IDs must be unique per project.
```
`deploymentId` (`next.config.ts`) to `VERCEL_GIT_COMMIT_SHA` (12 znaków), od 2026-09-23 z prefiksem
`VERCEL_ENV` (`prod-`/`prev-`/`deve-`) — to jest `VersionWatcher` (klient porównuje go z
`/api/version` i przeładowuje się, gdy wykryje nowszy build). Skoro rdzeń ID nadal zależy 1:1 od
hasha commita, kolizja wraca za każdym razem, gdy **ten sam commit + to samo środowisko** deployuje
się dwa razy. Dwie znane przyczyny:
1. Ręczny `vercel --prod` po tym samym pushu (patrz nagłówek wyżej) — oba deploye to środowisko
   `production`, więc prefiks ich nie rozróżnia; nie odpalaj `vercel --prod` ręcznie.
2. **(Naprawione 2026-09-23, było źródłem tego zgłoszenia)** ten sam commit trafiający na `dev` i
   `main` przez fast-forward merge — Vercel deployuje push na `dev` jako `preview`, a na `main` jako
   `production`; bez prefiksu środowiska te dwa deploye dzieliły identyczny `deploymentId` mimo
   różnych środowisk. Prefiks `VERCEL_ENV` to rozróżnia — nie cofaj go z powrotem do gołego hasha.

**Co robić:**
- Normalny deploy na prod = zwykły `git push origin main`. Nic więcej nie trzeba odpalać.
- Jeśli mimo braku zmian w kodzie trzeba wymusić nowy deploy ("redeploy tego samego commita"), nie
  walcz z `vercel --prod --force` (to nie pomaga, bo kolizja jest po `deploymentId`, nie po cache) —
  zrób pusty commit i wypchnij go: `git commit --allow-empty -m "..." && git push origin main`.
  Nowy sha → nowy `deploymentId` → integracja GitHub sama zdeployuje.
- `realtime-server/` na Fly.io to osobny mechanizm, bez tego problemu — `fly deploy` z
  `realtime-server/` zawsze idzie bezpośrednio na `studyquest`, nie ma tam integracji git ani
  kolizji ID. Fly **nie ma** dziś osobnego env preview/staging — jeden `fly.toml`, jedna appka.

### Branch policy (od 2026-09-25): `main`, `dev`, i krótkotrwałe branche zadaniowe z Linear
Domyślnie pracujemy na dwóch branchach — `main` (prod) i `dev` (preview, patrz sekcja Deploy
wyżej). Dla pojedynczej, ręcznej zmiany nie twórz nowego brancha (`feature/...`, `fix/...` itd.) —
commituj bezpośrednio na `dev` (albo na `main`, jeśli zmiana ma od razu iść na prod).

Wyjątek: przy automatycznym przetwarzaniu zadań z Linear (np. agent pracujący w pętli po backlogu)
dopuszczalny jest krótkotrwały branch per zadanie, utworzony z `dev`, zmergowany z powrotem do
`dev` zaraz po ukończeniu zadania i usunięty po mergu — nie zostaje jako trwały branch
feature'owy, i nie trafia sam z siebie na `main`.

Do tego są dwa skrypty w `scripts/` (`git-push-target.sh` to wspólna logika, `git-push-preview.sh`
i `git-push-prod.sh` to cienkie wrappery), zarejestrowane jako aliasy gita w tym repo (`.git/config`,
więc **nie jest to commitowane** — po świeżym `git clone` trzeba je zarejestrować ponownie, patrz
komendy niżej):

```
git config alias.push-preview '!bash "$(git rev-parse --show-toplevel)/scripts/git-push-preview.sh"'
git config alias.push-prod '!bash "$(git rev-parse --show-toplevel)/scripts/git-push-prod.sh"'
```

Użycie:
```
git push-preview "commit message"   # commit + push na dev  → Vercel preview deploy
git push-prod    "commit message"   # commit + push na main → Vercel production deploy
```

Oba działają **niezależnie od tego, na którym z tych dwóch branchy aktualnie jesteś** — jeśli masz
niezacommitowane zmiany na `main`, a wołasz `git push-preview`, skrypt sam je odłoży (`git stash`),
przełączy na `dev`, przywróci zmiany, zcommituje i wypchnie, po czym wróci Cię z powrotem na `main`.
Jeśli jesteś już na branchu docelowym, po prostu commituje + pushuje na miejscu. Jeśli nie masz
żadnych niezacommitowanych zmian, oba komendy tylko przełączają/aktualizują/pushują dany branch.
Wiadomość commita jest wymagana tylko wtedy, gdy jest faktycznie coś do zacommitowania.

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
5. Dla ręcznej, pojedynczej zmiany nie twórz nowego brancha — patrz "Branch policy" wyżej. Praca
   zawsze na `main` albo `dev`; do przełączania/commitowania/pushowania używaj `git push-preview` /
   `git push-prod`, nie ręcznego `git checkout -b ...`. Wyjątek: automatyczne przetwarzanie zadań
   z Linear może użyć krótkotrwałego brancha per zadanie utworzonego z `dev`, zmergowanego z
   powrotem do `dev` i usuniętego zaraz po zakończeniu tego zadania.
6. Nigdy nie usuwaj żadnych assetów (grafik, spriteów, dźwięków itp.), nawet jeśli wyglądają na
   nieużywane w kodzie — mogą się jeszcze przydać do legacy skinów. Jeśli asset trzeba usunąć z
   aktywnego użycia, przenieś go do katalogu `archive/` (zachowując strukturę podkatalogów
   źródła, np. `public/sprites/foo.png` → `archive/public/sprites/foo.png`) zamiast go kasować.
   Dotyczy to też czyszczenia repo/porządków — `git rm`/`rm` na assetach jest niedozwolone, chyba
   że użytkownik wprost poprosi o trwałe usunięcie konkretnego pliku.

   `archive/raw-assets/` (od 2026-09-25): surowe źródła sprite'ów/tilesetów, które trafiły do
   korzenia repo poza `public/` (arkusze `.aseprite`, wygenerowane rotacje kierunków, wycięty
   tileset `Interiors_free_16x16.png` ze slice'ami, `sprites.png`/`sprites.xml`) — przeniesione
   tu z korzenia repo, nie z `public/`, więc nie zachowują pełnej ścieżki źródłowej jak w
   przykładzie wyżej. Trzymane jako materiał wejściowy do (re)generowania spriteów w grze, nie
   jako aktywne assety gry.

   Po każdym rozwiązaniu commituj lub merguj od razu zmiany do dev