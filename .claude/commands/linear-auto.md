---
description: Loop through simple Linear backlog tasks needing no clarification, working each on its own branch off dev, merging back, and reporting conflicts at the end
---
Działaj w pętli, dopóki w backlogu Linearu są proste zadania, które nie wymagają wyjaśnień z Twojej
strony. Dla każdego zadania:

1. Jeśli widzisz, że zadanie zostało już faktycznie zrobione (kod/repo to potwierdza), oznacz je
   jako takie w Linearze i przejdź do następnego — nie wykonuj go od nowa.
2. W przeciwnym wypadku najpierw ustaw status zadania na In Progress, a dopiero potem zacznij je
   wykonywać.
3. Pracuj na krótkotrwałym branchu utworzonym z `dev` (zgodnie z wyjątkiem dla automatycznego
   przetwarzania zadań z Linear w `AGENTS.md` — branch per zadanie, nie na stałe). Gdy zadanie jest
   gotowe, zmerguj branch z powrotem do `dev` i usuń go.
4. Jeśli przy mergu wystąpi konflikt, nie rozwiązuj go sam — odpal nowego agenta (subagent), żeby
   zbadał ten konkretny konflikt i zaproponował/rozwiązał go. Zlicz ten przypadek wraz ze
   szczegółami (zadanie, plik(i), na czym polegał konflikt, jak został rozwiązany) do raportu
   końcowego.
5. Jeśli natrafisz na zadanie wymagające wyjaśnienia od użytkownika, pomiń je (zostaw w backlogu,
   nie zaznaczaj jako In Progress) i zanotuj je do raportu końcowego zamiast pytać w trakcie pętli.

Zatrzymaj pętlę, gdy nie zostaną już żadne proste zadania nienadające się do samodzielnego
wykonania. Na koniec przedstaw użytkownikowi raport: ile zadań ukończono, ile oznaczono jako już
zrobione, ile pominięto (i dlaczego), oraz pełne szczegóły każdego przypadku konfliktu przy mergu
i tego, jak został rozwiązany.
