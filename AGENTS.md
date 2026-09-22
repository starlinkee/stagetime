<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


<!-- poniższe na razie ignore dopóki nie usune tego taga-->

# Architektura Projektu: Multiplayer 2D Game (TypeScript)

## Kontekst Systemowy
Projekt to gra wieloosobowa 2D działająca w czasie rzeczywistym. Gra opiera się na architekturze autorytatywnego serwera (Authoritative Server). Repozytorium jest zorganizowane jako Monorepo (npm/pnpm workspaces) i dzieli się na trzy główne pakiety: `/client`, `/server` oraz `/shared`.

## Żelazne Zasady Podziału Modułów (Zabrania się łamania tych reguł):

### 1. Moduł `/client` (Frontend)
- **Środowisko:** Przeglądarka (hostowane na Vercel).
- **Technologia:** TypeScript + framework renderujący (np. Phaser/Excalibur).
- **Rola:** Wyłącznie warstwa prezentacyjna i zbieranie danych wejściowych.
- **Zakazy dla AI:** W tym module NIE WOLNO implementować żadnej logiki decyzyjnej potworów, kalkulacji obrażeń, sztucznej inteligencji, ani weryfikacji kolizji wpływających na stan gry. Kod kliencki ma jedynie odtwarzać animacje (z plików Sprite Sheet) i dźwięki w reakcji na pakiety danych przychodzące z serwera.

### 2. Moduł `/server` (Backend)
- **Środowisko:** Node.js, stały proces z WebSockets (np. Colyseus).
- **Rola:** "Mózg gry". Przeliczanie głównej pętli (Game Loop), utrzymywanie jedynego, prawdziwego stanu świata.
- **Sztuczna Inteligencja (AI Potworów):** Cała logika przeciwników musi znajdować się tutaj. Należy stosować wzorzec Skończonej Maszyny Stanów (FSM - np. stany `IDLE`, `CHASE`, `ATTACK`). 
- **Zadania Serwera:** To serwer sprawdza odległości (pathfinding), decyduje o zmianie stanu potwora na "Atak", przelicza matematycznie obrażenia graczy, oblicza procentowy udział każdego gracza w walce i na tej podstawie rozdziela złoto oraz punkty doświadczenia. Po wykonaniu obliczeń rozsyła do klientów zaktualizowany stan świata i powiadomienia (eventy).

### 3. Moduł `/shared` (Współdzielony)
- **Rola:** Pojedyncze źródło prawdy dla typów.
- **Zawartość:** Interfejsy TypeScript (np. `MonsterState`, `PlayerStats`), stałe konfiguracyjne (bazowe statystyki, rozmiary hitboxów), algorytmy matematyczne niezależne od platformy.
- **Zasada:** Zarówno klient, jak i serwer muszą importować definicje z tego pakietu.

## Instrukcje dla Asystenta AI przy generowaniu kodu:
1. Generując nową mechanikę, zachowanie AI lub atak, ZAWSZE rozpocznij od definicji typów w `/shared`.
2. Następnie zaimplementuj matematykę, FSM i logikę po stronie `/server`.
3. Na końcu zmodyfikuj kod w `/client` wyłącznie w celu wizualnej reprezentacji zmian, które nastąpiły na serwerze (np. dodaj kod odtwarzający konkretną klatkę ze Sprite Sheet, gdy serwer wyśle sygnał ataku).

<!-- END: poniższe na razie ignore dopóki nie usune tego taga-->