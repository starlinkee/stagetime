-- Mapa urosła 2x w każdą oś (patrz CONTENT_OX/OY w RoomStage.tsx): dotychczasowa treść
-- (kwadraty pokoi, punkt startu) stoi teraz na środku większej mapy, przesunięta o (800, 450)
-- względem starego układu 0..1600 x 0..900. Bez tego jednorazowego przesunięcia zapisane wcześniej
-- pozycje wylądowałyby w pustym, odległym rogu nowej mapy zamiast przy znajomych kwadratach pokoi.
-- Uruchom w Supabase → SQL Editor (jednorazowo, po 0019).

update public.player_positions set x = x + 800, y = y + 450;
