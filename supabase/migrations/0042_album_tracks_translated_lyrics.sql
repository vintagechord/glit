alter table public.album_tracks
  add column if not exists translated_lyrics text;
