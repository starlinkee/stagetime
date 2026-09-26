---
description: Pick the single highest-priority Linear backlog task, ask clarifying questions if needed, then rewrite its description with full details
---
Przejdź jednorazowo przez backlog w Linearze, zaczynając od zadania o najwyższym priorytecie, i
w dół po priorytecie sprawdzaj kolejne, aż znajdziesz pierwsze zadanie, które da się doprecyzować
(czyli takie, gdzie albo wszystko już rozumiesz, albo brakujące informacje możesz uzyskać, zadając
użytkownikowi pytania). To jest polecenie jednorazowe — obsłuż wyłącznie to jedno zadanie, nie
przechodź do kolejnych.

Kroki:

1. Wylistuj backlog Linearu posortowany od najwyższego priorytetu i wybierz pierwsze zadanie, które
   jeszcze nie ma solidnego, szczegółowego opisu (np. jednoliniowy tytuł bez kontekstu, bez
   kryteriów akceptacji, bez wskazania których plików/modułów dotyczy). Zaraz po wybraniu tego
   zadania zaznacz je w Linearze jako In Progress, zanim zaczniesz cokolwiek dalej robić.
2. Przeczytaj istniejący opis zadania oraz komentarze, jeśli są. Jeżeli czegoś nie wiesz, a jest to
   potrzebne, aby napisać dobry opis (np. dokładne zachowanie, zakres, priorytety UX, czy dotyczy
   `realtime-server` czy `src/`), zadaj użytkownikowi konkretne pytania — nie zgaduj i nie
   wymyślaj wymagań, których nikt nie podał.
3. Na podstawie odpowiedzi użytkownika (i własnej analizy repo, jeśli pomaga) napisz lepszy opis
   tego jednego zadania: jasny problem/cel, zakres (co jest w środku, co nie), konkretne kryteria
   akceptacji, i — jeśli to pomaga — wskazanie właściwego miejsca w kodzie zgodnie z architekturą
   z `AGENTS.md` (np. czy zmiana zaczyna się w `realtime-server/shared/`, czy jest wyłącznie w
   `src/`).
4. Zaktualizuj opis zadania w Linearze tym nowym tekstem (zastąp stary opis, nie dopisuj się do
   niego chaotycznie — chyba że użytkownik prosi o dopisanie). Nie implementuj samego zadania —
   to polecenie zajmuje się tylko doprecyzowaniem opisu.
5. Gdy opis jest gotowy i zapisany, zaznacz zadanie w Linearze jako Done.
6. Na koniec pokaż użytkownikowi krótkie podsumowanie: które zadanie wybrałeś i co zmieniłeś
   w opisie.
