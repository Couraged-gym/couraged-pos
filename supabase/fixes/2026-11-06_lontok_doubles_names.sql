-- =====================================================================
-- One-time data fix, 2026-11-06. Run AFTER 027_names_and_link_guard.sql.
-- Supabase › SQL Editor › paste all › Run. It is one transaction: if any
-- line fails, nothing changes. Not safe to re-run (merges delete doubles).
-- Delete or comment out any line you don't agree with first.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- A. Security: the app account giannolontok@gmail.com is showing
-- FEROLINO, JOULE FRAIZER SURBAN (CRDFH26-695). The account made this
-- record online on Nov 4; on Nov 6 the front desk typed Joule's name and
-- mobile over it and sold Joule a plan. Joule keeps the record, visits
-- and plans. The account loses it, and the pass QR and friend code it
-- saw are replaced. The account is then linked to LONTOK, AUGOSTO
-- ANTONIO (CRDFH25-085), keeping the privacy consent it gave on Nov 4.
-- ---------------------------------------------------------------------
-- 1. Copy the account's email and consent onto Augosto's record (login comes in step 3).
update public.members a
   set email = j.email, consent_version = j.consent_version, consented_at = j.consented_at,
       notes = concat_ws(E'\n', a.notes, 'Nov 6: linked to app login giannolontok@gmail.com by admin (was wrongly on CRDFH26-695).')
  from public.members j
 where a.code = 'CRDFH25-085' and a.user_id is null
   and j.code = 'CRDFH26-695' and j.user_id = '455dfe52-ee73-405d-ae3d-62c834b6d1bf';

-- 2. Take the login off Joule's record.
update public.members
   set user_id = null, email = null, consent_version = null, consented_at = null,
       qr_token = 'CDQ' || replace(gen_random_uuid()::text, '-', ''),
       friend_code = public.new_friend_code(),
       notes = concat_ws(E'\n', notes, 'Nov 6: unlinked from app login giannolontok@gmail.com (record was reused for this member).')
 where code = 'CRDFH26-695' and user_id = '455dfe52-ee73-405d-ae3d-62c834b6d1bf';

-- 3. Give the login to Augosto. Stops the whole fix if it didn't land.
update public.members set user_id = '455dfe52-ee73-405d-ae3d-62c834b6d1bf'
 where code = 'CRDFH25-085' and user_id is null;
do $$ begin
  if (select code from public.members where user_id = '455dfe52-ee73-405d-ae3d-62c834b6d1bf') is distinct from 'CRDFH25-085' then
    raise exception 'giannolontok@gmail.com is not on CRDFH25-085; nothing was changed';
  end if;
end $$;

-- Paid-before period dated 1989-10-17 to 1990-10-16 on the same record:
-- a birth date typed into "paid until". It's expired, so it does nothing,
-- but it clutters the history.
update public.member_periods set voided = true
 where id = 'cadfca9a-fada-4226-94aa-149602662b70' and starts_on = '1989-10-17';

-- ---------------------------------------------------------------------
-- B. Doubles: the same person registered at the desk and online. The
-- online record was made because the desk had a mistyped mobile.
-- merge_members(keep, drop) moves the app login, visits and plans onto
-- the desk record, notes the dropped code and mobile, and deletes the
-- double. Check the mobile afterwards; both numbers are kept in Notes.
-- ---------------------------------------------------------------------
select public.merge_members((select id from public.members where code = 'CRDFH25-270'),  (select id from public.members where code = 'CRDFH26-0704')); -- JAMOROL, JOHN JOMER
select public.merge_members((select id from public.members where code = 'CRDFH25-266'),  (select id from public.members where code = 'CRDFH26-0699')); -- BALI, STEVEN JOE
select public.merge_members((select id from public.members where code = 'CRDFH26-692'),  (select id from public.members where code = 'CRDFH26-0701')); -- SUGANOB, KURT LAWRENCE
select public.merge_members((select id from public.members where code = 'CRDFH25-308'),  (select id from public.members where code = 'CRDFH26-0700')); -- DIAZ, JOSE JUNRY
select public.merge_members((select id from public.members where code = 'CRDFH26-668'),  (select id from public.members where code = 'CRDFH26-0703')); -- RIDAD, BYRD
select public.merge_members((select id from public.members where code = 'CRDFH25-595'),  (select id from public.members where code = 'CRDFH26-0702')); -- BONTILAO, CEDRICK
select public.merge_members((select id from public.members where code = 'CRDFH25-521'),  (select id from public.members where code = 'CRDFH26-0705')); -- QUIMBO, CHRIS NINO
select public.merge_members((select id from public.members where code = 'CRDFH25-0074'), (select id from public.members where code = 'CRDFH25-074'));  -- DIMAUNAHAN, RYARD SETH (keeps the linked, correctly spelled one)
-- Kept as separate records on purpose (owner's call, Nov 6): LOPEZ, SAMUEL
-- LEIGH (CRDFH25-260) / Leigh Lopez (CRDFH26-0698), and SANTIAGO, ALFREDO
-- (CRDFH24-061 / CRDFH25-061).

-- ---------------------------------------------------------------------
-- C. Names with no comma, rewritten as "LAST, FIRST MIDDLE". The order
-- comes from how each was typed (the desk writes surname first; online
-- sign-ups wrote first name first).
-- ---------------------------------------------------------------------
update public.members m set full_name = v.name from (values
  ('CRDFH26-631', 'BIHAG, JENELYN LIMOTAN'),
  ('CRDFH26-687', 'BEJO, CHARISSA ROXAS'),
  ('CRDFH26-688', 'DELA CRUZ, JAYNEVA COMISSION'),
  ('CRDFH26-686', 'RAAGAS, FIONA ALJIONAE CEZAR'),
  ('CRDFH26-684', 'ERANA, JOMARIE PETALCORIN'),
  ('CRDFH26-649', 'AGUIRRE, SEED CRISTOBAL'),
  ('CRDFH26-635', 'LOPEZ, GIL'),
  ('CRDFH26-633', 'KING, JARED'),
  ('CRDFH26-632', 'MINOZA, CLIFFORD BIHAG'),
  ('CRDFH26-629', 'CALONIA, ABIGAIL SOLON'),
  ('CRDFH26-628', 'ASIGNAR, SAN CHAI SEDILLO'),
  ('CRDFH26-627', 'OPORTO, JUSTINE MARIE ONG'),
  ('CRDFH26-626', 'LABAO, JACQUELINE LOZANO'),
  ('CRDFH26-621', 'MAGALLANES, CLYED ANN MARIE MAMOLO'),
  ('CRDFH26-620', 'CASTRO, NINO'),
  ('CRDFH26-619', 'UY, ANTONIO ALJECERA'),
  ('CRDFH26-618', 'DIZON, BEN'),
  ('CRDFH26-689', 'MENDEZONA, JOHN MICHAEL TAN'),
  ('CRDFH26-617', 'COMPAYAN, JOHN DYLAN C.'),
  ('CRDFH26-615', 'BONTILAO, KEMART ARCILLA'),
  ('CRDFH25-613', 'SABAS, SHAWN TALLO'),
  ('CRDFH25-614', 'DINSAY, ESTEFANIE'),
  ('CRDFH25-550', 'DE ERE, HELEN'),
  ('CRDFH26-683', 'FERNANDEZ, JANINE MAY BEQUILLA'),
  ('CRDFH26-680', 'BATITANG, ANGELO MAYAKI'),
  ('CRDFH26-630', 'TARIMAN, MIGUEL C.'),
  ('CRDFH26-661', 'AUDITOR, KHUGO SEBASTIAN ENRIQUEZ'),
  ('CRDFH26-658', 'BIBERA, VENUS MCCLINTOCK'),
  ('CRDFH26-681', 'KING, ISA'),
  ('CRDFH26-682', 'MARANON, BON BORRES'),
  ('CRDFH26-685', 'GUASIN, KASSANDRA MARIE MANICSIC'),
  ('CRDFH25-512', 'CABADSAN, DAN ANTHONY FORTUNA'),
  ('CRDFH25-363', 'LIM, SEAN BENEDICT BUCADO'),
  ('CRDFH25-381', 'FLORES, REINA NORTEZ'),
  ('CRDFH25-225', 'FACIOL, JENNALYN ANTOLIHAO'),
  ('CRDFH25-026', 'CORDERO, ANTONE ROBERT'),
  ('CRDFH25-272', 'REYES, FHIL CHRISTIAN MATA'),
  ('CRDFH26-693', 'ANOSA, NICE GUEN'),
  ('CRDFH26-694', 'GONZAGA, MARNE'),
  ('CRDFH26-616', 'ZHANG, XUZ'),
  ('CRDFH26-622', 'ZHANG, XINHAI (JASPER)'),
  ('CRDFH26-623', 'WANG, XIYUZ (SHEA)'),
  ('CRDFH26-625', 'LEE, HYE MI'),
  ('CRDFH26-672', 'BAEK, JINA'),
  ('CRDFH26-671', 'CHOI, LILY'),
  ('CRDFH26-654', 'PARK, EUNA'),
  ('CRDFH26-0696', 'LANGAMIN, LEOVINCENT'),
  ('CRDFH26-0697', 'CODENIERA, KARL ANGELO')
) v(code, name) where m.code = v.code;

-- ---------------------------------------------------------------------
-- D. Everyone else: capitals, single spaces, one space after the comma
-- (the 027 trigger formats each name as it is saved).
-- ---------------------------------------------------------------------
update public.members set full_name = full_name where full_name is distinct from public.format_name(full_name);

-- Quick check: Ferolino has_app = false, Lontok Augosto has_app = true, the doubles in B are gone.
select code, full_name, phone, user_id is not null as has_app from public.members
 where code in ('CRDFH26-695', 'CRDFH25-085', 'CRDFH25-270', 'CRDFH25-266', 'CRDFH26-692', 'CRDFH25-308', 'CRDFH26-668', 'CRDFH25-595', 'CRDFH25-521', 'CRDFH25-0074')
 order by full_name;

commit;
