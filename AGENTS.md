<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Architektura Projektu: stan na 2026-09-23

Ta appka to coworking z timerem Pomodoro (nie gra RPG). Repo **nie jest** monorepo — nie ma
`/client`, `/server`, `/shared`, nie ma Colyseus, nie ma AI potworów ani FSM.

### `src/` — Next.js (App Router), warstwa prezentacji + część danych
- Frontend na Vercel; `src/app/api/*` to bezstanowe route handlery Next.js.
- `src/components/RoomStage.tsx` — scena pokoju: rysowanie, input, i (za flagą, patrz niżej)
  klient sieciowy do `realtime-server`.
- `src/lib/supabaseAdmin.ts` — jedyne miejsce w Next.js używające `SUPABASE_SERVICE_ROLE_KEY`
  (bypass RLS), wołane wyłącznie przez `src/app/api/internal/positions/route.ts` na potrzeby
  `realtime-server` (zapis/odczyt pozycji w imieniu gracza, którego sesji Next.js nie ma).
- `src/app/api/realtime/token/route.ts` — mintuje krótkotrwały, podpisany token wejścia
  (`@realtime-shared/entryToken`) na podstawie sesji Supabase Auth; `realtime-server` ufa
  wyłącznie temu tokenowi, nigdy danym podanym wprost przez klienta.
- Supabase: Auth (konta/sesje), Postgres (profile, XP, monety, `player_positions`, czat),
  presence i historia czatu przez Realtime.

### `realtime-server/` — autorytatywny serwer WebSocket (Node + `ws`), deploy na Fly.io
- Osobny pakiet npm w tym samym repo (`package.json`, `Dockerfile`, `fly.toml`; appka Fly
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
HP poszło jako pola w `Conn` (`realtime-server/src/server.ts`) i logika w tej samej pętli tick —
bez Colyseusa. Ekonomia i AI przeciwników **same w sobie nie uzasadniają** migracji: Colyseus
rozwiązuje matchmaking wielu pokoi i delta-encoding stanu, czyli problemy, których to repo dziś
nie ma (`MAX_PLAYERS_PER_ROOM` = 50, `rooms` to zwykła `Map` po `roomSlug`). Nie proponuj
migracji na Colyseus tylko dlatego, że pojawia się ekonomia/AI.

**Progi, przy których warto to zrewidować:** stały ruch w stronę >50 graczy/pokój, albo wiele
jednocześnie żywych pokoi z realną potrzebą matchmakingu — a najbardziej oba naraz.

### Flaga rolloutu
Ruch + walka na serwerze działają **tylko** gdy `NEXT_PUBLIC_REALTIME_SERVER_URL` jest ustawione
w `src/`. Bez tej zmiennej `RoomStage.tsx` liczy ruch/walkę w 100% lokalnie u każdego klienta i
rozgłasza peer-to-peer przez Supabase Broadcast, bez wspólnej autorytatywnej prawdy. Kierunek
docelowy: pełne przejście na `realtime-server` wszędzie — klient ma z czasem odpowiadać
wyłącznie za wygląd (rendering/animacje), nie za wynik.

### Deploy: Vercel jest już podpięty pod `git push` — nie wołaj `vercel --prod` ręcznie
Projekt Vercel ma aktywną integrację z GitHubiem na branchu `main`: sam `git push origin main`
wywołuje deploy na produkcję. Ręczny `vercel --prod` po tym pushu ściga się o ten sam
`deploymentId` (`next.config.ts` = `VERCEL_ENV` prefix + `VERCEL_GIT_COMMIT_SHA`) i zawsze
przegrywa, z błędem:
```
A deployment with the user-configured deploymentId "<sha>" already exists in this project.
```

**Co robić:**
- Normalny deploy na prod = zwykły `git push origin main`. Nic więcej nie trzeba odpalać.
- Żeby wymusić redeploy tego samego commita: pusty commit, nie `vercel --prod --force`
  (kolizja jest po `deploymentId`, nie po cache) — `git commit --allow-empty -m "..." && git push origin main`.
- `realtime-server/` na Fly.io to osobny mechanizm bez tego problemu — `fly deploy` z
  `realtime-server/` idzie bezpośrednio na `studyquest`. Fly nie ma dziś env preview/staging —
  jeden `fly.toml`, jedna appka.

### Branch policy (od 2026-09-25): `main`, `dev`, i krótkotrwałe branche zadaniowe z Linear
Domyślnie pracujemy na dwóch branchach — `main` (prod) i `dev` (preview). Dla pojedynczej,
ręcznej zmiany nie twórz nowego brancha (`feature/...`, `fix/...` itd.) — commituj bezpośrednio
na `dev` (albo na `main`, jeśli zmiana ma od razu iść na prod).

Wyjątek: przy automatycznym przetwarzaniu zadań z Linear dopuszczalny jest krótkotrwały branch
per zadanie, utworzony z `dev`, zmergowany z powrotem do `dev` zaraz po ukończeniu zadania i
usunięty po mergu — nie zostaje jako trwały branch feature'owy, i nie trafia sam z siebie na `main`.

Do tego są aliasy gita (`.git/config`, **nie commitowane** — po świeżym `git clone` trzeba je
zarejestrować ponownie):
```
git config alias.push-preview '!bash "$(git rev-parse --show-toplevel)/scripts/git-push-preview.sh"'
git config alias.push-prod '!bash "$(git rev-parse --show-toplevel)/scripts/git-push-prod.sh"'
```
Użycie:
```
git push-preview "commit message"   # commit + push na dev  → Vercel preview deploy
git push-prod    "commit message"   # commit + push na main → Vercel production deploy
```
Oba działają niezależnie od tego, na którym z tych dwóch branchy aktualnie jesteś — jeśli masz
niezacommitowane zmiany na innym branchu, skrypt sam je odłoży (`git stash`), przełączy,
przywróci, zcommituje i wypchnie, po czym wróci Cię z powrotem. Wiadomość commita jest wymagana
tylko wtedy, gdy jest faktycznie coś do zacommitowania.

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

7. Nie używaj emoji/ikonek Unicode w tekstach generowanych dla użytkownika (napisy w UI, treść
   wiadomości czatu, komunikaty systemowe itp.) — czysty tekst, bez ozdobników w stylu 💰/✅/🎉.

8. Teksty widoczne w grze dla gracza (opisy stref/obiektów typu Fountain of Wealth, komunikaty
   toastów, treści dialogów in-world) pisz w klimacie roleplay, nie technicznym opisem
   mechaniki. Np. zamiast tłumaczyć wprost, że coś zapisuje wartość do bazy danych/funduszu, opisz
   to jako coś, co dzieje się w świecie gry (rzucasz monetę do fontanny, kto wie do czego to
   doprowadzi) — utrzymuj tę konwencję dla wszelkich przyszłych podobnych napisów. Nie dotyczy to
   UI poza światem gry (ustawienia, formularze kont, komunikaty błędów systemowych) — tam nadal
   pisz wprost.

   Po każdym rozwiązaniu commituj lub merguj od razu zmiany do dev