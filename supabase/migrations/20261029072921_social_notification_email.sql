-- An owner-editable contact address, separate from Auth login identities.
alter table public.profiles add column notification_email text;

alter table public.profiles add constraint profiles_notification_email_format
  check (notification_email is null or (
    notification_email = lower(btrim(notification_email))
    and char_length(notification_email) <= 254
    and notification_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ));

comment on column public.profiles.notification_email is
  'Review notification contact for social members without an Auth email. Existing profile owner RLS applies.';
