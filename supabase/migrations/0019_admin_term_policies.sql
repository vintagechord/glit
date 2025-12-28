do $$
begin
  create policy "Admin manages profanity terms"
    on public.profanity_terms
    for all
    using (public.is_admin())
    with check (public.is_admin());
exception
  when duplicate_object then
    null;
end $$;

do $$
begin
  create policy "Admin manages spellcheck terms"
    on public.spellcheck_terms
    for all
    using (public.is_admin())
    with check (public.is_admin());
exception
  when duplicate_object then
    null;
end $$;
